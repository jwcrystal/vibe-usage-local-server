import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRICES_PATH = join(__dirname, 'prices.json');

// Load the local price table once. Users edit prices.json to tune pricing.
// Format: { models: { "<model>": { input, output, cacheReadMtok } } } where
// the *_Mtok values are USD per million tokens. A model absent from the table
// yields no price -> estimatedCost is nil (matches the upsteam contract where
// an unmatched model returns nil).
export function loadPrices() {
  let raw;
  try {
    raw = JSON.parse(readFileSync(PRICES_PATH, 'utf-8'));
  } catch {
    // Never crash the server on a malformed price file — degrade to empty table.
    return { models: {} };
  }
  const models = raw.models && typeof raw.models === 'object' ? raw.models : {};
  return { models };
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
