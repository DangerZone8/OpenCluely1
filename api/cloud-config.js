"use strict";

const DEFAULT_CONFIG = {
  schemaVersion: 1,
  revision: "default-1",
  minimumAppVersion: "1.0.0",
  pollIntervalMs: 300000,
  rolloutPercent: 100,
  features: {
    cloudConfig: true,
    newSettingsExperience: false,
    premiumAi: false,
    advancedScreenAnalysis: false,
    betaFeatures: false
  },
  presentation: { announcement: "", announcementUrl: "" },
  contentPack: { revision: "builtin-1", prompts: {}, events: [] }
};
const FEATURE_KEYS = Object.keys(DEFAULT_CONFIG.features);

function sanitizeConfig(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("Configuration must be an object.");
  const revision = typeof candidate.revision === "string" && /^[a-zA-Z0-9._-]{1,80}$/.test(candidate.revision)
    ? candidate.revision : null;
  const minimumAppVersion = typeof candidate.minimumAppVersion === "string" &&
    /^\d+\.\d+\.\d+$/.test(candidate.minimumAppVersion) ? candidate.minimumAppVersion : null;
  const pollIntervalMs = Number.isInteger(candidate.pollIntervalMs) &&
    candidate.pollIntervalMs >= 60000 && candidate.pollIntervalMs <= 86400000 ? candidate.pollIntervalMs : null;
  const rolloutPercent = Number.isInteger(candidate.rolloutPercent) &&
    candidate.rolloutPercent >= 0 && candidate.rolloutPercent <= 100 ? candidate.rolloutPercent : null;
  if (!revision || !minimumAppVersion || pollIntervalMs === null || rolloutPercent === null) {
    throw new Error("Configuration metadata is invalid.");
  }
  if (!candidate.features || typeof candidate.features !== "object" || Array.isArray(candidate.features)) {
    throw new Error("Feature flags are invalid.");
  }
  const features = {};
  for (const key of FEATURE_KEYS) {
    if (typeof candidate.features[key] !== "boolean") throw new Error("Feature flag is invalid: " + key);
    features[key] = candidate.features[key];
  }
  const presentation = candidate.presentation && typeof candidate.presentation === "object" ? candidate.presentation : {};
  const announcement = typeof presentation.announcement === "string" ? presentation.announcement.slice(0, 240) : "";
  const announcementUrl = typeof presentation.announcementUrl === "string" &&
    /^https:\/\/(?:slicklyai\.vercel\.app|github\.com\/DangerZone8\/OpenCluely1)(?:\/|$)/.test(presentation.announcementUrl)
    ? presentation.announcementUrl : "";
  const contentPackInput = candidate.contentPack && typeof candidate.contentPack === "object" && !Array.isArray(candidate.contentPack)
    ? candidate.contentPack : {};
  const contentRevision = typeof contentPackInput.revision === "string" && /^[a-zA-Z0-9._-]{1,80}$/.test(contentPackInput.revision)
    ? contentPackInput.revision : "builtin-1";
  const promptInput = contentPackInput.prompts && typeof contentPackInput.prompts === "object" && !Array.isArray(contentPackInput.prompts)
    ? contentPackInput.prompts : {};
  const prompts = {};
  for (const [skill, content] of Object.entries(promptInput)) {
    if (skill !== "dsa" || typeof content !== "string" || !content.trim() || content.length > 30000) {
      throw new Error("Remote prompt content is invalid.");
    }
    prompts[skill] = content;
  }
  const eventInput = Array.isArray(contentPackInput.events) ? contentPackInput.events : [];
  if (eventInput.length > 10) throw new Error("Too many remote content events.");
  const events = eventInput.map(event => {
    if (!event || typeof event !== "object" || Array.isArray(event) ||
        typeof event.id !== "string" || !/^[a-zA-Z0-9._-]{1,64}$/.test(event.id) ||
        typeof event.title !== "string" || !event.title.trim() || event.title.length > 80 ||
        typeof event.body !== "string" || !event.body.trim() || event.body.length > 500 ||
        typeof event.startsAt !== "string" || !Number.isFinite(Date.parse(event.startsAt)) ||
        typeof event.endsAt !== "string" || !Number.isFinite(Date.parse(event.endsAt)) ||
        Date.parse(event.endsAt) <= Date.parse(event.startsAt)) {
      throw new Error("Remote content event is invalid.");
    }
    return { id: event.id, title: event.title.trim(), body: event.body.trim(),
      startsAt: new Date(event.startsAt).toISOString(), endsAt: new Date(event.endsAt).toISOString() };
  });
  if (new Set(events.map(event => event.id)).size !== events.length) {
    throw new Error("Remote content event IDs must be unique.");
  }
  return { schemaVersion: 1, revision, minimumAppVersion, pollIntervalMs, rolloutPercent, features, presentation: { announcement, announcementUrl }, contentPack: { revision: contentRevision, prompts, events } };
}

module.exports = async function cloudConfig(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    res.statusCode = 405;
    return res.end("Method not allowed");
  }
  let config = DEFAULT_CONFIG;
  // Prefer the administrator-managed database snapshot. Environment JSON remains
  // a safe bootstrap fallback for deployments that have not applied migration 3.
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const url = String(process.env.SUPABASE_URL).replace(/\/$/, "") + "/rest/v1/slickly_cloud_config?select=config&id=eq.true&limit=1";
      const response = await fetch(url, { headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY
      } });
      if (response.ok) {
        const rows = await response.json();
        if (Array.isArray(rows) && rows[0]?.config) config = sanitizeConfig(rows[0].config);
      } else if (response.status !== 404) {
        throw new Error("Cloud configuration database request failed.");
      }
    } catch (error) {
      console.error("Slickly cloud config database read failed:", error.message);
      res.statusCode = 503;
      res.setHeader("Cache-Control", "no-store");
      return res.end("Cloud configuration is temporarily unavailable.");
    }
  }
  if (config === DEFAULT_CONFIG && process.env.SLICKLY_CLOUD_CONFIG_JSON) {
    try {
      config = sanitizeConfig(JSON.parse(process.env.SLICKLY_CLOUD_CONFIG_JSON));
    } catch (error) {
      console.error("Invalid SLICKLY_CLOUD_CONFIG_JSON:", error.message);
      res.statusCode = 503;
      res.setHeader("Cache-Control", "no-store");
      return res.end("Cloud configuration is temporarily unavailable.");
    }
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD");
  return res.end(req.method === "HEAD" ? "" : JSON.stringify(config));
};

module.exports.sanitizeConfig = sanitizeConfig;
module.exports.DEFAULT_CONFIG = DEFAULT_CONFIG;
