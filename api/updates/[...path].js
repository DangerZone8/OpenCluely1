"use strict";
const RELEASE_API = "https://api.github.com/repos/DangerZone8/OpenCluely1/releases/latest";
const ALLOWED = /^(latest(?:-mac|-linux)?\.yml|[^/\\\\]+\.(?:exe|dmg|zip|AppImage|deb|apk|ipa|blockmap))$/i;

function requestedAsset(req) {
  const raw = req.query && req.query.path;
  let candidate = Array.isArray(raw) ? (raw.length === 1 ? raw[0] : null) : raw;

  // Vercel normally supplies the catch-all segment in req.query.path. Some
  // routing/proxy configurations omit it, so recover the same segment from
  // the request URL rather than rejecting a valid installer request.
  if (candidate == null && typeof req.url === "string") {
    const pathname = new URL(req.url, "https://slickly.invalid").pathname;
    const prefix = "/api/updates/";
    if (pathname.startsWith(prefix)) candidate = pathname.slice(prefix.length);
  }
  if (typeof candidate !== "string") return null;
  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    return null;
  }
  return candidate;
}

function reply(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.end(body);
}

module.exports = async function updateFeed(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return reply(res, 405, "Method not allowed");
  }
  const assetName = requestedAsset(req);
  if (!assetName || !ALLOWED.test(assetName) || assetName.includes("..") || assetName.includes("/") || assetName.includes("\\\\")) {
    return reply(res, 400, "Invalid update asset path");
  }
  try {
    const releaseResponse = await fetch(RELEASE_API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Slickly-AI-Vercel-Update-Feed", "X-GitHub-Api-Version": "2022-11-28" }
    });
    if (!releaseResponse.ok) return reply(res, releaseResponse.status === 404 ? 404 : 502, "Latest release metadata unavailable", { "Cache-Control": "no-store" });
    const release = await releaseResponse.json();
    const asset = Array.isArray(release.assets) ? release.assets.find(item => item && item.name === assetName && typeof item.browser_download_url === "string") : null;
    if (!asset) return reply(res, 404, "Update asset not found", { "Cache-Control": "no-store" });
    const headers = { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300", "X-Content-Type-Options": "nosniff" };
    if (assetName.endsWith(".yml")) {
      if (req.method === "HEAD") return reply(res, 200, "", { ...headers, "Content-Type": "text/yaml; charset=utf-8" });
      const manifestResponse = await fetch(asset.browser_download_url, { headers: { Accept: "application/octet-stream" } });
      if (!manifestResponse.ok) return reply(res, 502, "Update manifest could not be fetched", { "Cache-Control": "no-store" });
      return reply(res, 200, await manifestResponse.text(), { ...headers, "Content-Type": "text/yaml; charset=utf-8" });
    }
    // Keep large installers off the Vercel Function response path.
    res.statusCode = 302;
    res.setHeader("Location", asset.browser_download_url);
    res.setHeader("Cache-Control", headers["Cache-Control"]);
    res.end();
  } catch (error) {
    console.error("Slickly update feed error:", error && error.message ? error.message : error);
    return reply(res, 502, "Update feed temporarily unavailable", { "Cache-Control": "no-store" });
  }
};
