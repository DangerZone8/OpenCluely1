"use strict";
const RELEASE_API = "https://api.github.com/repos/DangerZone8/OpenCluely1/releases/latest";
const ALLOWED = /^(latest(?:-mac|-linux)?\.yml|[^/\\\\]+\.(?:exe|dmg|zip|AppImage|deb|blockmap))$/i;
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
  const value = req.query && req.query.path;
  const parts = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  if (parts.length !== 1 || !ALLOWED.test(parts[0]) || parts[0].includes("..")) {
    return reply(res, 400, "Invalid update asset path");
  }
  try {
    const releaseResponse = await fetch(RELEASE_API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Slickly-AI-Vercel-Update-Feed", "X-GitHub-Api-Version": "2022-11-28" }
    });
    if (!releaseResponse.ok) return reply(res, releaseResponse.status === 404 ? 404 : 502, "Latest release metadata unavailable", { "Cache-Control": "no-store" });
    const release = await releaseResponse.json();
    const asset = Array.isArray(release.assets) ? release.assets.find(item => item && item.name === parts[0] && typeof item.browser_download_url === "string") : null;
    if (!asset) return reply(res, 404, "Update asset not found", { "Cache-Control": "no-store" });
    const headers = { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300", "X-Content-Type-Options": "nosniff" };
    if (parts[0].endsWith(".yml")) {
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
