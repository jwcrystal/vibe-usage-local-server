import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../src/ui/dashboard.html', import.meta.url), 'utf8');
const start = html.indexOf('function quotaPanel(');
const end = html.indexOf('\nfunction computeTotal(', start);
const render = runInNewContext(html.slice(start, end) + '\nquotaPanel', {
  esc: value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'),
  fmtLocalDT: value => String(value),
});

function snapshot(id = 'codex', utilization = 16) {
  return {
    id, status: 'ok', hostname: 'test-host', fetchedAt: new Date().toISOString(),
    meters: [{ id: 'five-hour', label: '5h', utilization, windowSeconds: 18000,
      resetsAt: new Date(Date.now() + 9000000).toISOString() }],
  };
}

test('quota meters group mode-labelled percentages, bars and reset countdowns', () => {
  const remaining = render([snapshot()], 'remaining', ['codex']);
  assert.match(remaining, /剩餘 84%/);
  assert.match(remaining, /週期已過 50%（時間進度，非配額用量）/);
  assert.ok(remaining.indexOf('quota-meter-value') < remaining.indexOf('quota-bars'));
  assert.ok(remaining.indexOf('quota-bars') < remaining.indexOf('quota-meter-reset'));
  assert.match(render([snapshot()], 'used', ['codex']), /已用 16%/);
  // Warning colour stays tied to usage, even in remaining mode.
  assert.match(render([snapshot('codex', 95)], 'remaining', ['codex']), /quota-meter-value full">剩餘 5%/);
});

test('quota controls share a toolbar without changing selection behaviour', () => {
  const single = render([snapshot()], 'remaining', ['codex']);
  assert.match(single, /quota-actions"><span class="quota-mode"/);
  assert.match(single, /id="quotaManage"/);
  const multiple = render([snapshot()], 'remaining', ['codex', 'commandcode']);
  assert.equal((multiple.match(/<article /g) || []).length, 2);
  // Placeholder keeps the card frame: skeleton meters, busy flag, tip.
  assert.match(multiple, /aria-busy="true"/);
  assert.match(multiple, /quota-skel quota-skel-bar/);
  assert.match(multiple, /CommandCode 已啟用 · 等待下次同步更新/);
  const off = render([snapshot()], 'remaining', []);
  assert.doesNotMatch(off, /<article /);
  assert.match(off, /id="quotaManage"/);
  assert.match(off, /所有訂閱配額顯示已關閉/);
  assert.equal((render([snapshot()], 'remaining', null).match(/<article /g) || []).length, 1);
});
