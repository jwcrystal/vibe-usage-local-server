import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

// Embedded default price table, bundled into the standalone binary at build
// time via the JSON import below (works under plain Node >= 20.10 too).
import defaultPrices from './prices.json' with { type: 'json' };

// User-editable override locations, in priority order (first hit wins):
//   1. ~/.vibe-usage-server/prices.json  — same data dir as store.js (use
//      VIBE_USAGE_SERVER_DIR to relocate). Good for npm-global installs:
//      the file lives next to the user data, not inside node_modules, so a
//      reinstall never wipes it.
//   2. a `prices.json` beside the running executable — convenient for a
//      standalone dist/ binary (drop a prices.json beside the exe to tune
//      pricing without rebuilding). Under plain `node` dev this resolves to
//      the Node binary's dir, so it never shadows ./src/prices.json.
// Malformed/unreadable overrides fall through to the embedded default.
const DATA_DIR = process.env.VIBE_USAGE_SERVER_DIR?.trim() || join(homedir(), '.vibe-usage-server');

function readOverride(file) {
  if (!existsSync(file)) return null;
  const parsed = JSON.parse(readFileSync(file, 'utf-8'));
  if (parsed.models && typeof parsed.models === 'object') return parsed;
  return null;
}

export function loadPrices() {
  for (const candidate of [
    join(DATA_DIR, 'prices.json'),
    join(dirname(process.execPath), 'prices.json'),
  ]) {
    try {
      const parsed = readOverride(candidate);
      if (parsed) return parsed;
    } catch {
      // Malformed or unreadable — keep scanning candidates.
    }
  }
  return defaultPrices;
}

// Compute estimated cost for one bucket. Returns a number, or null if the
// model is not in the price table.
// formula: input*inputRate + output*outputRate + cachedInput*cacheReadRate
export function estimateCost(bucket, prices = loadPrices()) {
  const entry = prices.models[bucket.model];
  if (!entry) return null;
  const perToken = {
    input: (entry.input ?? 0) / 1_000_000,
    output: (entry.output ?? 0) / 1_000_000,
    cacheRead: (entry.cacheReadMtok ?? 0) / 1_000_000,
  };
  const input = Number(bucket.inputTokens ?? 0);
  const output = Number(bucket.outputTokens ?? 0);
  const cached = Number(bucket.cachedInputTokens ?? 0);
  const reasoning = Number(bucket.reasoningOutputTokens ?? 0);
  return input * perToken.input + (output + reasoning) * perToken.output + cached * perToken.cacheRead;
}
