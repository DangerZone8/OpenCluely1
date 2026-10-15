#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourceDir = path.join(root, "web");
const outputDir = path.join(root, "web-dist");
const sourceIndex = path.join(sourceDir, "index.html");

if (!fs.existsSync(sourceIndex)) {
  console.error("Vercel build failed: web/index.html is missing.");
  process.exit(1);
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
fs.cpSync(sourceDir, outputDir, { recursive: true });

if (!fs.existsSync(path.join(outputDir, "index.html"))) {
  console.error("Vercel build failed: index.html was not copied to web-dist.");
  process.exit(1);
}

console.log("Vercel static site built successfully into web-dist/");
