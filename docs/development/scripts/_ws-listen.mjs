#!/usr/bin/env node
/**
 * Tiny WS listener used by capture-integration.sh.
 *
 * Connects to the URL in argv[2] and prints every received frame for
 * argv[3] milliseconds, then exits 0.
 */
import WebSocket from "ws";

const url = process.argv[2];
const durationMs = Number(process.argv[3] ?? 1500);

if (!url) {
  console.error("usage: _ws-listen.mjs <url> [durationMs]");
  process.exit(2);
}

const ws = new WebSocket(url);
const timer = setTimeout(() => {
  ws.close();
}, durationMs);

ws.on("open", () => console.log(`-- ws open ${url}`));
ws.on("message", (data) => {
  const text = typeof data === "string" ? data : data.toString("utf8");
  console.log(text);
});
ws.on("error", (e) => {
  console.error(`-- ws error: ${e.message}`);
  clearTimeout(timer);
  process.exit(1);
});
ws.on("close", () => {
  clearTimeout(timer);
  console.log("-- ws closed");
});
