"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const CONFIG_URL = "https://slicklyai.vercel.app/api/cloud-config";
const DEFAULT_CONFIG = Object.freeze({
  schemaVersion: 1,
  revision: "default-1",
  minimumAppVersion: "1.0.0",
  pollIntervalMs: 900000,
  rolloutPercent: 100,
  features: {
    cloudConfig: true,
    newSettingsExperience: false,
    premiumAi: false,
    advancedScreenAnalysis: false,
    betaFeatures: false
  },
  presentation: {
    announcement: "",
    announcementUrl: ""
  }
});
const FEATURE_KEYS = Object.keys(DEFAULT_CONFIG.features);

function versionParts(value) {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+$/.test(value)) return null;
  return value.split(".").map(Number);
}

function isVersionAtLeast(actual, minimum) {
  const a = versionParts(actual);
  const b = versionParts(minimum);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

function validateConfig(input, appVersion, installId = "local") {
  if (!input || typeof input !== "object" || Array.isArray(input) || input.schemaVersion !== 1) {
    throw new Error("Unsupported cloud configuration schema.");
  }
  if (typeof input.revision !== "string" || !/^[a-zA-Z0-9._-]{1,80}$/.test(input.revision)) {
    throw new Error("Invalid cloud configuration revision.");
  }
  if (!versionParts(input.minimumAppVersion)) throw new Error("Invalid minimum app version.");
  if (!isVersionAtLeast(appVersion, input.minimumAppVersion)) {
    throw new Error("This app version is no longer supported by the cloud configuration.");
  }
  if (!Number.isInteger(input.pollIntervalMs) || input.pollIntervalMs < 60000 || input.pollIntervalMs > 86400000) {
    throw new Error("Invalid cloud configuration polling interval.");
  }
  if (!Number.isInteger(input.rolloutPercent) || input.rolloutPercent < 0 || input.rolloutPercent > 100) {
    throw new Error("Invalid rollout percentage.");
  }
  if (!input.features || typeof input.features !== "object" || Array.isArray(input.features)) {
    throw new Error("Invalid cloud feature flags.");
  }
  const features = {};
  for (const key of FEATURE_KEYS) {
    if (typeof input.features[key] !== "boolean") throw new Error("Invalid feature flag: " + key);
    features[key] = input.features[key];
  }
  const presentation = input.presentation && typeof input.presentation === "object"
    ? input.presentation : {};
  const announcement = typeof presentation.announcement === "string"
    ? presentation.announcement.slice(0, 240) : "";
  const announcementUrl = typeof presentation.announcementUrl === "string" &&
    /^https:\/\/(?:slicklyai\.vercel\.app|github\.com\/DangerZone8\/OpenCluely1)(?:\/|$)/.test(presentation.announcementUrl)
    ? presentation.announcementUrl : "";
  const bucket = crypto.createHash("sha256").update(String(installId)).digest().readUInt32BE(0) % 100;
  const inRollout = bucket < input.rolloutPercent;
  return {
    schemaVersion: 1,
    revision: input.revision,
    minimumAppVersion: input.minimumAppVersion,
    pollIntervalMs: input.pollIntervalMs,
    rolloutPercent: input.rolloutPercent,
    inRollout,
    features: Object.fromEntries(FEATURE_KEYS.map(key => [key, inRollout && features[key]])),
    presentation: { announcement, announcementUrl },
    fetchedAt: new Date().toISOString()
  };
}

class CloudConfigService {
  constructor(options = {}) {
    this.cachePath = options.cachePath || path.join(process.cwd(), ".slickly-cloud-config.json");
    this.appVersion = options.appVersion || "1.0.0";
    this.fetch = options.fetch || globalThis.fetch;
    this.url = options.url || CONFIG_URL;
    this.logger = options.logger || { info() {}, warn() {} };
    this.installId = options.installId || "local-install";
    this.snapshot = this.readCache() || validateConfig(DEFAULT_CONFIG, this.appVersion, this.installId);
  }

  readCache() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.cachePath, "utf8"));
      return validateConfig(parsed, this.appVersion, this.installId);
    } catch (_) {
      return null;
    }
  }

  getSnapshot() {
    return JSON.parse(JSON.stringify(this.snapshot));
  }

  async refresh() {
    if (typeof this.fetch !== "function") return this.getSnapshot();
    const response = await this.fetch(this.url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error("Cloud config request failed with HTTP " + response.status);
    const body = await response.json();
    const next = validateConfig(body, this.appVersion, this.installId);
    // Reject rollback to a previously observed revision when revision numbers
    // are monotonic numeric suffixes. Non-numeric revisions remain opaque.
    const currentMatch = this.snapshot.revision.match(/^(.*?)(\d+)$/);
    const nextMatch = next.revision.match(/^(.*?)(\d+)$/);
    if (currentMatch && nextMatch && currentMatch[1] === nextMatch[1] &&
        Number(nextMatch[2]) < Number(currentMatch[2])) {
      throw new Error("Rejected stale cloud configuration revision.");
    }
    this.snapshot = next;
    await fs.promises.mkdir(path.dirname(this.cachePath), { recursive: true });
    const tempPath = this.cachePath + ".tmp";
    await fs.promises.writeFile(tempPath, JSON.stringify(body), { mode: 0o600 });
    await fs.promises.rename(tempPath, this.cachePath);
    this.logger.info("Slickly cloud configuration updated", { revision: next.revision, inRollout: next.inRollout });
    return this.getSnapshot();
  }
}

module.exports = { CloudConfigService, DEFAULT_CONFIG, validateConfig, isVersionAtLeast };
