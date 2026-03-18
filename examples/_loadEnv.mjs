import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** Loads `<repo>/.env` into process.env without overwriting already-set vars. */
export function loadDotEnv(metaUrl) {
  const here = dirname(fileURLToPath(metaUrl));
  const envPath = join(here, "..", ".env");
  try {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (!m) continue;
      const k = m[1].trim();
      const v = m[2].trim().replace(/^["']|["']$/g, "");
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch {
    // .env not present; ok
  }
}
