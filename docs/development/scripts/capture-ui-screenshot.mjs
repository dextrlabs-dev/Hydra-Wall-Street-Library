#!/usr/bin/env node
/**
 * Playwright screenshot of the React UI (engine URL via localStorage).
 *
 * Expects the engine-server on $ENGINE_URL and a UI host on $UI_URL.
 *
 * Usage:
 *   UI_URL=http://localhost:4173 ENGINE_URL=http://localhost:8080 \
 *     node docs/development/scripts/capture-ui-screenshot.mjs
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
process.chdir(repoRoot);

const uiUrl = process.env.UI_URL ?? "http://localhost:4173";
const engineUrl = process.env.ENGINE_URL ?? "http://localhost:8080";
const out = join(repoRoot, "docs", "development", "screenshots", "react-ui.png");
mkdirSync(dirname(out), { recursive: true });

const { chromium } = await import("playwright");

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // First navigate to the page so we have an origin for localStorage.
  await page.goto(uiUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate((url) => window.localStorage.setItem("engineBaseUrl", url), engineUrl);
  await page.reload({ waitUntil: "domcontentloaded" });

  // Wait for the markets dropdown to populate with real symbols.
  await page.waitForFunction(
    () => {
      const sel = document.querySelector("select");
      return !!sel && Array.from(sel.options).some((o) => o.value === "AAPL");
    },
    null,
    { timeout: 10_000 },
  );
  await page.selectOption("select", "AAPL");
  await page.waitForFunction(
    () => !!document.querySelector(".book table tbody tr"),
    null,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(750); // allow metrics polling to fire once

  await page.screenshot({ path: out, fullPage: true });
  console.log(`saved ${out}`);
} finally {
  await browser.close();
}
