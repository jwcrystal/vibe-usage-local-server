import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const dashboard = readFileSync(new URL('../src/ui/dashboard.html', import.meta.url), 'utf8');
const script = dashboard.match(/<script>([\s\S]*?)<\/script>/)[1];
const formatters = script.slice(script.indexOf('const money ='), script.indexOf('// Local "'));
const report = script.slice(script.indexOf('function reportDelta('), script.indexOf('// The current filtered bucket set'));
const fileDate = script.slice(script.indexOf('function fileDate('), script.indexOf('function exportCsv('));
const metrics = { cost: 128.4, total: 24800000, input: 8200000, output: 3100000,
  cached: 12000000, cacheWrite: 1500000, active: 3600, duration: 7200,
  sessions: 142, msgs: 1820, userMsgs: 640 };
const meta = { from: '2026-09-01', to: '2026-10-01', rangeLabel: '自訂',
  generatedAt: '2026-10-01 10:00', counts: '500 筆資料 · 142 個會話',
  prevFrom: '2026-08-02 00:00', prevTo: '2026-09-01 00:00',
  filtersText: '項目=<demo>', unpriced: ['<unknown>'] };

function context(extra = {}) {
  const ctx = vm.createContext(extra);
  vm.runInContext(formatters + fileDate + report, ctx);
  return ctx;
}

test('report groups all metrics under four primary KPIs and retains safe breakdowns', () => {
  const ctx = context();
  const rows = [['<model>', { cost: 128.4, tokens: 24800000, n: 500 }]];
  const html = ctx.reportHtml(meta, metrics, metrics, rows, rows, rows);
  assert.equal((html.match(/class="kpi"/g) || []).length, 4);
  assert.equal((html.match(/class="detail"/g) || []).length, 7);
  for (const label of ['用量摘要', 'Token 明細', '其他活動', '活躍時長', '按模型', '按工具', '按項目', '資料筆數', '費用佔比']) {
    assert.ok(html.includes(label), label);
  }
  for (const value of ['$128.40', '24.8M', '8.2M', '3.1M', '12.0M', '1.5M', '1h 0m', '2h 0m', '142', '1,820', '640']) {
    assert.ok(html.includes(value), value);
  }
  assert.equal((html.match(/class="d">持平/g) || []).length, 11);
  assert.ok(html.includes('比較基準：2026-08-02 00:00 ~ 2026-09-01 00:00'));
  assert.ok(html.includes('項目=&lt;demo&gt;'));
  assert.ok(html.includes('&lt;unknown&gt;'));
  assert.ok(html.includes('&lt;model&gt;'));
  assert.ok(!/<script|<link|<model>|<unknown>/.test(html));
  assert.ok(html.includes('thead{display:table-header-group}'));
  assert.ok(html.includes('break-inside:avoid'));
  assert.ok(html.includes('grid-template-columns:repeat(2,minmax(0,1fr))'));
});

test('report omits comparisons without previous data and handles empty breakdowns', () => {
  const ctx = context();
  const html = ctx.reportHtml({ ...meta, unpriced: [] }, metrics, null, [], [], []);
  assert.ok(!html.includes('class="comparison"'));
  assert.ok(!html.includes('class="d"'));
  assert.ok(!html.includes('class="warn"'));
  assert.equal((html.match(/無數據/g) || []).length, 3);
  assert.equal(ctx.reportDelta(10, 0), '');
  assert.equal(ctx.reportDelta(110, 100), '+10%');
  assert.equal(ctx.reportDelta(90, 100), '-10%');
});

test('export retains filtered inputs, dimensions and filename; empty previous data is unavailable', () => {
  for (const available of [false, true]) {
    let captured, clicked = false, revoked = false;
    const buckets = [{ model: 'demo', estimatedCost: null }];
    const session = { keep: true };
    const ctx = context({
      data: { rangeMeta: { curMin: 100000000, curMax: 200000000, span: 100000000 }, sessions: [session, { keep: false }] },
      prev: { buckets: available ? buckets : [], sessions: [] },
      currentBuckets: () => buckets,
      sessInRange: () => true,
      matchFilters: (s) => s.keep,
      sumMetrics: (bs, ss) => { if (bs === buckets && ss.length) assert.deepEqual(ss, [session]); return metrics; },
      FILTER_KEYS: ['project'], FILTER_LABELS: { project: '項目' }, filters: { project: 'demo' },
      rangeLabel: () => '自訂',
      byKey: (bs, key) => { assert.equal(bs, buckets); return key; },
      Blob,
      URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => { revoked = true; } },
      document: { createElement: () => ({ click() { clicked = this.download.startsWith('vibe-usage-report_') && this.download.endsWith('.html'); } }) },
    });
    ctx.reportHtml = (...args) => { captured = args; return '<html></html>'; };
    ctx.exportReport();
    assert.ok(clicked && revoked);
    assert.equal(captured[2] === null, !available);
    assert.equal(captured[0].filtersText, '項目=demo');
    assert.deepEqual(Array.from(captured[0].unpriced), ['demo']);
    assert.deepEqual(captured.slice(3), ['model', 'source', 'project']);
    assert.ok(captured[0].prevFrom && captured[0].prevTo);
  }
});
