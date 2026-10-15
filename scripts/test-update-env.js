const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const dotenv = require("dotenv");

const writer = path.resolve(__dirname, "update-env.js");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencluely-env-test-"));
const envPath = path.join(tempDir, ".env");

try {
  fs.writeFileSync(envPath, "# preserved comment\nKEEP=unchanged\nWHISPER_COMMAND=old\nWHISPER_COMMAND=duplicate\n", "utf8");
  const cases = [
    ["WHISPER_COMMAND", "C:\\Users\\Jane Doe\\bin\\whisper.exe"],
    ["SPECIAL_VALUE", "dollar$pipe|ampersand&hash#and spaces"],
    ["QUOTED_VALUE", "both'quotes\"and\\slashes"],
    ["EMPTY_VALUE", ""],
    ["GEMINI_API_KEY", "abc123"]
  ];

  for (const [key, value] of cases) {
    const result = spawnSync(process.execPath, [writer, key, value], { cwd: tempDir, encoding: "utf8" });
    assert.strictEqual(result.status, 0, result.stderr || "writer failed for " + key);
    const parsed = dotenv.parse(fs.readFileSync(envPath, "utf8"));
    assert.strictEqual(parsed[key], value.replace(/[\r\n]+/g, " ").trim(), "round-trip failed for " + key);
  }

  const finalText = fs.readFileSync(envPath, "utf8");
  assert(finalText.includes("# preserved comment"), "existing comments should remain");
  assert(finalText.includes("KEEP=unchanged"), "unrelated settings should remain");
  assert.strictEqual((finalText.match(/^WHISPER_COMMAND=/gm) || []).length, 1, "duplicate key assignments should be collapsed");
  console.log("Environment writer tests passed: paths, metacharacters, quotes, empty values, and duplicate keys.");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
