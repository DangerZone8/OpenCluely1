const fs = require("fs");
const path = require("path");

const [key, rawValue] = process.argv.slice(2);
if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || rawValue === undefined) {
  console.error("Usage: node scripts/update-env.js KEY VALUE");
  process.exit(2);
}

const envPath = path.resolve(process.cwd(), ".env");
const value = String(rawValue).replace(/[\r\n]+/g, " ").trim();

function encodeValue(input) {
  if (input === "") return "";
  const startsWithQuote = input[0] === "'" || input[0] === '"' || input[0] === String.fromCharCode(96);
  const needsQuotes = /\s/.test(input) || input.includes("#") || startsWithQuote;
  if (!needsQuotes) return input;

  const delimiters = ["'", '"', String.fromCharCode(96)];
  const delimiter = delimiters.find((candidate) => !input.includes(candidate));
  if (!delimiter) {
    throw new Error("Cannot safely encode an .env value containing all quote styles and requiring quotes.");
  }
  return delimiter + input + delimiter;
}

let contents = "";
try {
  contents = fs.readFileSync(envPath, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const lines = contents ? contents.split(/\r?\n/) : [];
const assignment = key + "=" + encodeValue(value);
let replaced = false;
const output = [];
for (const line of lines) {
  if (line.startsWith(key + "=")) {
    if (!replaced) {
      output.push(assignment);
      replaced = true;
    }
    continue;
  }
  output.push(line);
}
if (!replaced) output.push(assignment);
while (output.length && output[output.length - 1] === "") output.pop();

const dir = path.dirname(envPath);
const tempPath = path.join(dir, "." + path.basename(envPath) + "." + process.pid + ".tmp");
fs.writeFileSync(tempPath, output.join("\n") + "\n", { encoding: "utf8", mode: 0o600 });
try { fs.chmodSync(tempPath, 0o600); } catch (_) {}
fs.renameSync(tempPath, envPath);
try { fs.chmodSync(envPath, 0o600); } catch (_) {}
