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
  // Near resets count down; distant resets render a local date instead of
  // an unreadable "30 天 3 小時" string.
  const distant = render([{
    ...snapshot(), meters: [{ id: 'monthly', label: 'Month', utilization: 10,
      resetsAt: new Date(Date.now() + 30.2 * 86400000).toISOString() }],
  }], 'remaining', ['codex']);
  assert.match(distant, /\d{2}\/\d{2}後重置/);
  assert.doesNotMatch(distant, /30 天/);
  // Definitive empty answers render their reason text, not a loading state.
  const emptyCard = render([{
    id: 'claude-code', status: 'no_data', hostname: 'test-host', meters: [],
    fetchedAt: new Date().toISOString(), emptyReason: 'notDetected',
  }], 'remaining', ['claude-code']);
  assert.match(emptyCard, /未偵測到本機安裝或登入 · 請先配置該工具/);
  assert.doesNotMatch(emptyCard, /quota-skel/);
  const rejected = render([{
    id: 'codex', status: 'no_data', hostname: 'test-host', meters: [],
    fetchedAt: new Date().toISOString(), emptyReason: 'unauthorized',
  }], 'remaining', ['codex']);
  assert.match(rejected, /登入已過期或被拒絕 · 請在該工具重新登入/);
  // Unknown reason falls back to the neutral line.
  const unknownReason = render([{
    id: 'codex', status: 'no_data', hostname: 'test-host', meters: [],
    fetchedAt: new Date().toISOString(), emptyReason: 'whatever',
  }], 'remaining', ['codex']);
  assert.match(unknownReason, /尚未讀取到配額資料/);
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
  // Manage rows are two-line: toggle state plus where the product stands,
  // or how to configure it when off — a lightweight config surface.
  assert.match(multiple, /quota-row-name">✓ Codex</);
  assert.match(multiple, /quota-row-sub">已啟用 · 等待同步</);
  assert.match(multiple, /quota-row-sub">未啟用 · 需安裝 Claude Code 並以訂閱帳號登入</);
  const withPlan = render([{ ...snapshot(), planLabel: 'Plus' }], 'remaining', ['codex']);
  assert.match(withPlan, /quota-row-sub">正常 · Plus</);
  const menuOff = render([], 'remaining', ['codex', 'claude-code']);
  assert.match(menuOff, /quota-row-sub">未啟用 · 登入：CommandCode CLI</);
  assert.match(menuOff, /quota-row-sub">未啟用 · 需安裝 OpenCode 並登入</);
  assert.match(menuOff, /quota-row-name">✓ Claude Code</);
  const off = render([snapshot()], 'remaining', []);
  assert.doesNotMatch(off, /<article /);
  assert.match(off, /id="quotaManage"/);
  assert.match(off, /所有訂閱配額顯示已關閉/);
  assert.equal((render([snapshot()], 'remaining', null).match(/<article /g) || []).length, 1);
});
