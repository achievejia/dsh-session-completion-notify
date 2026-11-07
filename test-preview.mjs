import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNotification, previewText } from './preview.js';
import { normalizeConfig, createCompletionListener } from './core.js';

const msg = (seq, text, extra = {}) => ({ type: 'assistant/message', seq, data: { turn: 2, message: { role: 'assistant', content: [{ type: 'text', text }] }, ...extra } });
const end = { type: 'turn/end', seq: 12, data: { turn: 2, reason: { kind: 'completed' } } };
function fixture(events = []) {
  return { id: 'session-12345678', header: {}, firstLiveSeq: 0,
    eventAt(seq) { return events.find(e => e.seq === seq); } };
}
const config = () => normalizeConfig({});
test('Codex-like payload uses session title and latest response preview', () => {
  const s = fixture([msg(10, '**已完成部署。**\n服务已恢复。')]);
  assert.deepEqual(buildNotification(s, end, config(), () => '1103 | 发布 | 服务部署'), {
    title: '1103 | 发布 | 服务部署', body: '已完成部署。 服务已恢复。', sound: true
  });
});
test('uses latest assistant response; skips tool-call messages, interrupted output and reasoning', () => {
  const s = fixture([msg(6, '准备检查'), msg(8, '结论：已修复', { message: { content: [{ type: 'reasoning', text: 'hidden' }, { type: 'text', text: '结论：已修复' }] } }),
    msg(9, '中断内容', { interrupted: true }), msg(10, '调用工具', { message: { content: [{ type: 'text', text: '调用工具' }, { type: 'tool-call', name: 'bash' }] } })]);
  assert.equal(buildNotification(s, end, config(), () => '标题').body, '结论：已修复');
});
test('never borrows previous turn text', () => {
  const s = fixture([msg(3, '上一轮', { turn: 1 }), { type: 'turn/start', seq: 5, data: { turn: 2 } }]);
  assert.equal(buildNotification(s, end, config()).body, '本轮回复已完成');
});
test('preview disabled does not read assistant text and title disabled does not call title service', () => {
  const s = fixture(); s.eventAt = () => { throw Error('must not read'); };
  const c = normalizeConfig({ showPreview: false, showSessionTitle: false });
  assert.deepEqual(buildNotification(s, end, c, () => { throw Error('must not read title'); }), {
    title: 'DSH · 响应完成', body: '会话 12345678 的第 2 轮回复已完成', sound: true
  });
});
test('missing title and text fall back; title service failure does not suppress completion', () => {
  const p = buildNotification(fixture(), end, config(), () => { throw Error('unavailable'); });
  assert.equal(p.title, 'DSH · 响应完成'); assert.equal(p.body, '本轮回复已完成');
});
test('strips markdown links, image URLs, code fences and control characters', () => {
  assert.equal(previewText('# 结果\n**已完成** [查看](https://secret.example/a?token=abc)\n![图](https://img/a)\n```sh\necho password\n```\n正常\u0000\u202e', 120), '结果 已完成 查看 正常');
});
test('redacts common credentials and paths before truncating', () => {
  const text = 'token=abc123 password: hunter2 Bearer eyJ123456 sk-abcdefghijklmnopqrstuvwxyz /Users/baronm/private/file.txt';
  const safe = previewText(text, 240);
  for (const secret of ['abc123', 'hunter2', 'eyJ123456', 'sk-abcdefghijklmnopqrstuvwxyz', '/Users/baronm']) assert.equal(safe.includes(secret), false);
});
test('Unicode preview and title are bounded with an ellipsis', () => {
  const p = buildNotification(fixture([msg(10, '😀'.repeat(200))]), end, config(), () => '题'.repeat(200));
  assert.equal(Array.from(p.body).length, 120); assert.equal(Array.from(p.title).length, 80);
  assert.ok(p.body.endsWith('…')); assert.ok(p.title.endsWith('…'));
});
test('reads at most 256 nearby event positions and never calls full-history methods', () => {
  let reads = 0; const s = fixture(); s.eventAt = () => { reads++; return undefined; };
  buildNotification(s, { ...end, seq: 10000 }, config()); assert.equal(reads, 256);
});
test('title and preview are integrated in completion delivery', async () => {
  let payload;
  const handler = createCompletionListener({ config: config(), send: async p => { payload = p; },
    signal: new AbortController().signal, getTitle: () => '1103 | 功能 | 通知插件' });
  await handler(fixture([msg(10, '已按参考格式调整。')]), end);
  assert.equal(payload.title, '1103 | 功能 | 通知插件'); assert.equal(payload.body, '已按参考格式调整。');
});
