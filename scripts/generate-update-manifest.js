"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function fail(message) { console.error(message); process.exit(1); }
function yamlQuote(value) { return JSON.stringify(value); }
function createManifest(platform, version, directory) {
  const config = {
    win: { name: "latest.yml", files: file => /^Slickly-AI-Setup-.*\\.exe$/i.test(file) },
    mac: { name: "latest-mac.yml", files: file => /^Slickly\\.AI-.*(?:-mac)?\\.zip$/i.test(file) },
    linux: { name: "latest-linux.yml", files: file => /^Slickly\\.AI-.*\\.AppImage$/i.test(file) }
  }[platform];
  if (!config) throw new Error("Unsupported platform: " + platform);
  const names = fs.readdirSync(directory).filter(config.files).sort();
  if (!names.length) throw new Error("No auto-update artifacts found for " + platform + " in " + directory);
  const files = names.map(name => {
    const fullPath = path.join(directory, name);
    const data = fs.readFileSync(fullPath);
    return { url: name, sha512: crypto.createHash("sha512").update(data).digest("base64"), size: data.length };
  });
  const lines = [
    "version: " + yamlQuote(version),
    "files:",
    ...files.flatMap(file => [
      "  - url: " + yamlQuote(file.url),
      "    sha512: " + yamlQuote(file.sha512),
      "    size: " + file.size
    ]),
    "path: " + yamlQuote(files[0].url),
    "sha512: " + yamlQuote(files[0].sha512),
    "releaseDate: " + yamlQuote(new Date().toISOString()),
    ""
  ];
  const output = path.join(directory, config.name);
  fs.writeFileSync(output, lines.join("\n"), "utf8");
  return { output, files: files.map(file => file.url) };
}

if (require.main === module) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((all, arg, index, list) => {
    if (arg.startsWith("--")) all.push([arg.slice(2), list[index + 1]]);
    return all;
  }, []));
  if (!args.platform || !args.version) fail("Usage: node scripts/generate-update-manifest.js --platform win|mac|linux --version X.Y.Z [--dir dist]");
  try {
    const result = createManifest(args.platform, args.version, path.resolve(args.dir || "dist"));
    console.log("Generated " + result.output + " for " + result.files.join(", "));
  } catch (error) { fail(error.message); }
}
module.exports = { createManifest };
