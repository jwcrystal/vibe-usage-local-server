import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
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

// Recent timestamp (1h ago) so `days=30` windows always include it regardless
// of when the tests run — fixed calendar dates rot as real time moves on.
const recent = (minAgo = 60) => new Date(Date.now() - minAgo * 60_000).toISOString();

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

test('prices: cache write priced via cacheWriteMtok (Anthropic 1.25x input)', () => {
  const prices = loadPrices();
  const cost = estimateCost({ model: 'claude-sonnet-4-5-20250929', inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0, cacheCreation5mTokens: 1_000_000 }, prices);
  assert.equal(cost, 3.0 + 3.75);
});

test('prices: cache write ignored when the model has no cacheWriteMtok', () => {
  const prices = loadPrices();
  const glm = Object.keys(prices.models).find(k => /GLM-5\.3$/.test(k)) || Object.keys(prices.models).find(k => k.includes('GLM'));
  const cost = estimateCost({ model: glm, inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0, cacheCreation5mTokens: 5_000_000 }, prices);
  assert.equal(cost, prices.models[glm].input);
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
  assert.equal(json.quotaSnapshots, true);
});

test('quota snapshots are allowlisted, host-scoped, independent of date filters, and retained on failures', async () => {
  const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
  const snapshot = {
    id: 'codex', status: 'ok', meters: [{ id: 'five-hour', label: '5h', utilization: 42,
      amountUsed: 24.41, amountLimit: 70 }],
    fetchedAt: '2026-09-30T10:00:00.000Z', dataAsOf: '2026-09-30T10:00:00.000Z',
    planLabel: 'Plus', source: 'live', resetCredits: 4,
    resetCreditsAt: ['2026-10-04T01:25:57.655Z', '2026-10-22T18:59:11.966Z'],
    creditBalance: 12.5, accountId: 'must-not-be-stored',
  };
  const upload = async (hostname, quotas) => fetch(`${BASE()}/api/usage/ingest`, {
    method: 'POST', headers,
    body: JSON.stringify({ buckets: [], client: { hostname }, quotas }),
  });

  await upload('quota-host-a', [snapshot, {
    id: 'commandcode', status: 'retryable_error', meters: [],
    fetchedAt: '2026-09-30T10:01:00.000Z', dataAsOf: '2026-09-30T10:01:00.000Z',
  }]);
  await upload('quota-host-b', [{ ...snapshot, meters: [{ id: 'five-hour', label: '5h', utilization: 12 }] }]);
  await upload('quota-host-a', [{ ...snapshot, fetchedAt: '2026-09-30T10:02:00.000Z',
    dataAsOf: '2026-09-30T09:59:00.000Z', meters: [{ id: 'five-hour', label: '5h', utilization: 99 }] }]);
  await upload('quota-host-a', [{ ...snapshot, fetchedAt: '2026-09-30T10:03:00.000Z',
    dataAsOf: '2026-09-30T10:03:00.000Z', resetCredits: 2 }]);
  // A bad resetCredits poisons the whole snapshot: dropped, never partially
  // applied over the stored success.
  await upload('quota-host-a', [{ ...snapshot, fetchedAt: '2026-09-30T10:04:00.000Z',
    dataAsOf: '2026-09-30T10:04:00.000Z', resetCredits: 'many' }]);
  // So does a broken meter amount pair — or a broken credit-date list.
  await upload('quota-host-a', [{ ...snapshot, fetchedAt: '2026-09-30T10:05:00.000Z',
    dataAsOf: '2026-09-30T10:05:00.000Z', resetCreditsAt: 'nope', creditBalance: 'twelve',
    meters: [{ id: 'five-hour', label: '5h', utilization: 42, amountUsed: -1, amountLimit: 70 }] }]);

  const response = await fetch(`${BASE()}/api/usage?days=1`, { headers });
  const data = await response.json();
  assert.equal(data.quotas.length, 2);
  const hostA = data.quotas.find(item => item.hostname === 'quota-host-a');
  assert.equal(hostA.meters[0].utilization, 42);
  assert.equal(hostA.resetCredits, 2);
  assert.deepEqual(hostA.resetCreditsAt, ['2026-10-04T01:25:57.655Z', '2026-10-22T18:59:11.966Z']);
  assert.equal(hostA.creditBalance, 12.5);
  assert.equal(hostA.meters[0].amountUsed, 24.41);
  assert.equal(hostA.meters[0].amountLimit, 70);
  assert.equal('accountId' in hostA, false);
  assert.equal(data.quotas.some(item => item.id === 'commandcode'), false);

  const deleted = await fetch(`${BASE()}/api/usage/ingest?hostname=quota-host-a`, {
    method: 'DELETE', headers,
  });
  assert.equal(deleted.status, 200);
  const afterDelete = await (await fetch(`${BASE()}/api/usage`, { headers })).json();
  assert.deepEqual(afterDelete.quotas.map(item => item.hostname), ['quota-host-b']);
});

test('ingest sets estimatedCost on known model, null on unknown', async () => {
  const tKnown = recent(90), tUnknown = recent(80);
  await ingest([
    bucket({ model: 'claude-sonnet-4-5-20250929', bucketStart: tKnown, totalTokens: 100, inputTokens: 100, outputTokens: 0, cachedInputTokens: 0 }),
    bucket({ model: 'no-such-model', bucketStart: tUnknown, totalTokens: 100, inputTokens: 100, outputTokens: 0, cachedInputTokens: 0 }),
  ]);
  const res = await fetch(`${BASE()}/api/usage?days=30`, { headers: { Authorization: `Bearer ${KEY}` } });
  const json = await res.json();
  const known = json.buckets.find((b) => b.model === 'claude-sonnet-4-5-20250929' && b.bucketStart === tKnown);
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

test('usage returns sorted unpricedModels for models missing from price table', async () => {
  await ingest([
    bucket({ model: 'zz-unknown-model', bucketStart: recent(70), totalTokens: 10, inputTokens: 10, outputTokens: 0, cachedInputTokens: 0 }),
    bucket({ model: 'aa-unknown-model', bucketStart: recent(60), totalTokens: 10, inputTokens: 10, outputTokens: 0, cachedInputTokens: 0 }),
  ]);
  const res = await fetch(`${BASE()}/api/usage?days=30`, { headers: { Authorization: `Bearer ${KEY}` } });
  const json = await res.json();
  assert.ok(Array.isArray(json.unpricedModels));
  assert.ok(json.unpricedModels.includes('aa-unknown-model'));
  assert.ok(json.unpricedModels.includes('zz-unknown-model'));
  assert.ok(json.unpricedModels.indexOf('aa-unknown-model') < json.unpricedModels.indexOf('zz-unknown-model'));
  // Known models must not appear in the list.
  assert.equal(json.unpricedModels.includes('claude-sonnet-4-5-20250929'), false);
});

test('ui-assets serves whitelisted product icons and rejects everything else', async () => {
  const ok = await fetch(`${BASE()}/ui-assets/codex-icon@2x.png`);
  assert.equal(ok.status, 200);
  assert.ok((ok.headers.get('content-type') || '').startsWith('image/png'));
  assert.ok((await ok.arrayBuffer()).byteLength > 0);
  const svg = await fetch(`${BASE()}/ui-assets/commandcode-icon.svg`);
  assert.equal(svg.status, 200);
  assert.equal(svg.headers.get('content-type'), 'image/svg+xml');
  for (const bad of ['/ui-assets/..%2Fserver.js', '/ui-assets/nope.png', '/ui-assets/server.js']) {
    assert.equal((await fetch(`${BASE()}${bad}`)).status, 404);
  }
});

test('assertSafeBind: off-loopback binding requires an explicit key', async () => {
  const { assertSafeBind, supportsQuotaSnapshots } = await import('../src/server.js');
  assert.doesNotThrow(() => assertSafeBind('127.0.0.1', false));
  assert.doesNotThrow(() => assertSafeBind('localhost', false));
  assert.doesNotThrow(() => assertSafeBind('::1', false));
  assert.doesNotThrow(() => assertSafeBind('0.0.0.0', true));
  assert.throws(() => assertSafeBind('0.0.0.0', false));
  assert.throws(() => assertSafeBind('192.168.1.5', false));
  for (const host of ['127.0.0.1', 'localhost', '::1']) assert.equal(supportsQuotaSnapshots(host), true);
  for (const host of ['0.0.0.0', '192.168.1.5']) assert.equal(supportsQuotaSnapshots(host), false);
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

test('store: load creates .bak snapshot; corrupt main recovers from .bak', async () => {
  const { loadData, saveData, getDataPath } = await import('../src/store.js');
  const dir = process.env.VIBE_USAGE_SERVER_DIR;
  // Healthy save + load leaves a backup snapshot next to the data file.
  saveData({ buckets: [bucket({ bucketStart: '2026-08-05T13:00:00Z' })], sessions: [] });
  loadData();
  assert.ok(existsSync(join(dir, 'data.json.bak')));

  // Corrupt the main file with a known .bak in place: recovery returns the
  // backup's buckets and the corrupt bytes are preserved for inspection.
  writeFileSync(join(dir, 'data.json.bak'), JSON.stringify({
    buckets: [bucket({ bucketStart: '2026-08-05T14:00:00Z' })],
    sessions: [],
  }));
  writeFileSync(getDataPath(), '{corrupt');
  const recovered = loadData();
  assert.equal(recovered.buckets.length, 1);
  assert.equal(recovered.buckets[0].bucketStart, '2026-08-05T14:00:00Z');
  assert.ok(existsSync(join(dir, 'data.json.corrupt')));
  assert.equal(readFileSync(join(dir, 'data.json.corrupt'), 'utf-8'), '{corrupt');
});

test('prices: source-scoped table prices commandcode ids without touching other sources', () => {
  const prices = loadPrices();
  const cc = prices.sources.commandcode.models['gpt-5.6-sol'];
  assert.ok(cc, 'commandcode catalog entry present');
  const base = { model: 'gpt-5.6-sol', inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0 };
  // Command Code resolves through its own catalog price...
  assert.equal(estimateCost({ ...base, source: 'commandcode' }, prices), cc.input);
  // ...while the same id from another source keeps the model-keyed vendor price.
  assert.equal(estimateCost({ ...base, source: 'opencode' }, prices), prices.models['gpt-5.6-sol'].input);
  assert.notEqual(cc.input, prices.models['gpt-5.6-sol'].input);
});
