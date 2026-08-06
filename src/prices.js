import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

// Embedded default price table, bundled into the standalone binary at build
// time via the JSON import below (works under plain Node >= 20.10 too).
import defaultPrices from './prices.json' with { type: 'json' };

// A user-editable override: if a `prices.json` file sits next to the running
// executable, it wins over the embedded default. This keeps the '本地調價'
// core feature for the binary build — drop a prices.json beside the exe to
// tune pricing without rebuilding. Under plain `node` dev the override path
// resolves to the Node binary's directory, so it never shadows ./src/prices.json.
function externalPricesPath() {
  return join(dirname(process.execPath), 'prices.json');
}

export function loadPrices() {
  const ext = externalPricesPath();
  try {
    if (existsSync(ext)) {
      const parsed = JSON.parse(readFileSync(ext, 'utf-8'));
      if (parsed.models && typeof parsed.models === 'object') return parsed;
    }
  } catch {
    // Malformed or unreadable override — fall through to the embedded default.
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
