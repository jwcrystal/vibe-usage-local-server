import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const KEY = 'vbu_test_local_key_12345';
process.env.VIBE_USAGE_SERVER_KEY = KEY;
process.env.VIBE_USAGE_SERVER_DIR = mkdtempSync(join(tmpdir(), 'vibe-usage-test-'));

const { server } = await import('../src/server.js');
const { loadPrices, estimateCost } = await import('../src/prices.js');

let address;
before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  address = server.address();
});
after(async () => {
  await new Promise((r) => server.close(r));
  rmSync(process.env.VIBE_USAGE_SERVER_DIR, { recursive: true, force: true });
});

const BASE = () => `http://127.0.0.1:${address.port}`;

function bucket(over = {}) {
  return {
    source: 'claude-code',
    model: 'claude-sonnet-4-5-20250929',
    project: 'demo',
    hostname: 'mbp',
    bucketStart: '2026-08-05T10:00:00Z',
    inputTokens: 1000,
    outputTokens: 2000,
    cachedInputTokens: 3000,
    reasoningOutputTokens: 0,
    totalTokens: 6000,
    ...over,
  };
}

async function ingest(buckets, sessions) {
  const payload = { buckets };
  if (sessions) payload.sessions = sessions;
  const res = await fetch(`${BASE()}/api/usage/ingest`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
    },
    body: gzipSync(Buffer.from(JSON.stringify(payload))),
  });
  return { status: res.status, json: await res.json() };
}

test('prices: known model computes cost', () => {
  const prices = loadPrices();
  const cost = estimateCost({ model: 'claude-sonnet-4-5-20250929', inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: 0, reasoningOutputTokens: 0 }, prices);
  assert.equal(cost, 3.0 + 15.0);
});

test('prices: unmatched model returns null (nil)', () => {
  const prices = loadPrices();
  const cost = estimateCost({ model: 'totally-unknown-model', inputTokens: 1, outputTokens: 1 }, prices);
  assert.equal(cost, null);
});

test('same key keeps larger existing bucket (protected), smaller does not overwrite', async () => {
  await ingest([bucket({ bucketStart: '2026-08-05T10:00:00Z', totalTokens: 6000 })]);
  const bigRes = await ingest([bucket({ bucketStart: '2026-08-05T10:00:00Z', totalTokens: 9000 })]);
  assert.equal(bigRes.json.protected.buckets, 0);
  assert.equal(bigRes.json.ingested, 1);
  const smallRes = await ingest([bucket({ bucketStart: '2026-08-05T10:00:00Z', totalTokens: 3000 })]);
  assert.equal(smallRes.json.protected.buckets, 1);
  assert.equal(smallRes.json.ingested, 0);
});

test('unauthorized request rejected with 401', async () => {
  const res = await fetch(`${BASE()}/api/usage/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buckets: [] }),
  });
  assert.equal(res.status, 401);
});

test('settings returns uploadProject boolean', async () => {
  const res = await fetch(`${BASE()}/api/usage/settings`, { headers: { Authorization: `Bearer ${KEY}` } });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(typeof json.uploadProject, 'boolean');
  assert.equal(json.uploadProject, true);
});

test('ingest sets estimatedCost on known model, null on unknown', async () => {
  await ingest([
    bucket({ model: 'claude-sonnet-4-5-20250929', bucketStart: '2026-08-05T11:00:00Z', totalTokens: 100, inputTokens: 100, outputTokens: 0, cachedInputTokens: 0 }),
    bucket({ model: 'no-such-model', bucketStart: '2026-08-05T11:30:00Z', totalTokens: 100, inputTokens: 100, outputTokens: 0, cachedInputTokens: 0 }),
  ]);
  const res = await fetch(`${BASE()}/api/usage?days=30`, { headers: { Authorization: `Bearer ${KEY}` } });
  const json = await res.json();
  const known = json.buckets.find((b) => b.model === 'claude-sonnet-4-5-20250929' && b.bucketStart === '2026-08-05T11:00:00Z');
  const unknown = json.buckets.find((b) => b.model === 'no-such-model');
  assert.equal(typeof known.estimatedCost, 'number');
  assert.equal(unknown.estimatedCost, null);
  assert.equal(json.hasAnyData, true);
  assert.ok(Array.isArray(json.sessions));
});

test('usage filters by days', async () => {
  await ingest([bucket({ bucketStart: '2020-01-01T00:00:00Z' })]);
  const far = await fetch(`${BASE()}/api/usage?days=1`, { headers: { Authorization: `Bearer ${KEY}` } });
  const farJson = await far.json();
  assert.equal(farJson.buckets.some((b) => b.bucketStart === '2020-01-01T00:00:00Z'), false);
});

test('delete all clears data', async () => {
  const res = await fetch(`${BASE()}/api/usage/ingest`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${KEY}` },
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(json.deleted > 0);
  const chk = await fetch(`${BASE()}/api/usage?days=30`, { headers: { Authorization: `Bearer ${KEY}` } });
  const chkJson = await chk.json();
  assert.equal(chkJson.buckets.length, 0);
});
