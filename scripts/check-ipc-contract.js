const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const preloadPath = path.join(root, "preload.js");
const mainPath = path.join(root, "main.js");

const preload = fs.readFileSync(preloadPath, "utf8");
const main = fs.readFileSync(mainPath, "utf8");

const invokeChannels = [...preload.matchAll(/ipcRenderer\.invoke\(\s*["']([^"']+)["']/g)]
  .map((match) => match[1]);
const handlerChannels = [...main.matchAll(/ipcMain\.handle\(\s*["']([^"']+)["']/g)]
  .map((match) => match[1]);

const duplicates = (items) => [...new Set(items.filter((item, index) => items.indexOf(item) !== index))];
const missingHandlers = [...new Set(invokeChannels.filter((channel) => !handlerChannels.includes(channel)))];
const duplicateInvokes = duplicates(invokeChannels);
const duplicateHandlers = duplicates(handlerChannels);

if (missingHandlers.length || duplicateInvokes.length || duplicateHandlers.length) {
  if (missingHandlers.length) console.error("Missing ipcMain.handle() for preload invoke channels:", missingHandlers.join(", "));
  if (duplicateInvokes.length) console.error("Duplicate preload invoke channels:", duplicateInvokes.join(", "));
  if (duplicateHandlers.length) console.error("Duplicate ipcMain.handle() channels:", duplicateHandlers.join(", "));
  process.exitCode = 1;
} else {
  console.log("IPC contract check passed: " + invokeChannels.length + " preload invoke channels have unique main-process handlers.");
}
