const fs = require("fs");
const path = require("path");

const mainPath = path.resolve(__dirname, "..", "main.js");
const main = fs.readFileSync(mainPath, "utf8");

const hasMonitor = /process\.on\(\s*["']uncaughtExceptionMonitor["']/.test(main);
const suppressesUncaughtException = /process\.on\(\s*["']uncaughtException["']/.test(main);
const suppressesUnhandledRejection = /process\.on\(\s*["']unhandledRejection["']/.test(main);

if (!hasMonitor || suppressesUncaughtException || suppressesUnhandledRejection) {
  if (!hasMonitor) console.error("Missing uncaughtExceptionMonitor logger.");
  if (suppressesUncaughtException) console.error("Do not install a process.on('uncaughtException') handler that suppresses default termination.");
  if (suppressesUnhandledRejection) console.error("Do not install a process.on('unhandledRejection') handler that suppresses default termination.");
  process.exitCode = 1;
} else {
  console.log("Crash-handling check passed: fatal errors are monitored without suppressing default termination.");
}
