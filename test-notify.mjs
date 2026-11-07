import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCompletionListener, normalizeConfig, mountCompletionNotifications } from './core.js';
import { sendNativeNotification } from './native.js';

const end = (seq = 10, kind = 'completed', turn = 1) => ({ type: 'turn/end', seq, time: Date.now(), data: { turn, reason: { kind } } });
const session = (header = {}) => ({ id: 'session-12345678', firstLiveSeq: 5, header });
function setup(config = {}, send = async () => {}) {
  const controller = new AbortController();
  const delivered = [], errors = [];
  const handler = createCompletionListener({ config: normalizeConfig(config), signal: controller.signal,
    send: async (...args) => { await send(...args); delivered.push(args[0]); },
    onError: code => errors.push(code) });
  return { handler, delivered, errors, controller };
}

test('notifies once per new completed turn and permits the next turn', async () => {
  const { handler, delivered } = setup(); const s = session();
  await handler(s, end()); await handler(s, end()); await handler(s, end(11, 'completed', 2));
  assert.equal(delivered.length, 2);
});
test('independent sessions do not deduplicate each other', async () => {
  const { handler, delivered } = setup(); await handler(session(), end()); await handler(session(), end());
  assert.equal(delivered.length, 2);
});
test('ignores nonterminal events', async () => {
  const { handler, delivered } = setup(); await handler(session(), { type: 'assistant/message' });
  assert.equal(delivered.length, 0);
});
for (const kind of ['aborted', 'blocked', 'error', 'max-tokens', 'interrupted', 'forked']) {
  test(`does not label ${kind} as completed`, async () => {
    const { handler, delivered } = setup(); await handler(session(), end(10, kind)); assert.equal(delivered.length, 0);
  });
}
test('ignores historical and inherited events', async () => {
  const { handler, delivered } = setup(); await handler(session(), end(4)); assert.equal(delivered.length, 0);
});
for (const header of [{ parentSession: 'parent' }, { origin: 'subagent' }, { delegationDepth: 1 }]) {
  test(`skips child session ${JSON.stringify(header)}`, async () => {
    const { handler, delivered } = setup(); await handler(session(header), end()); assert.equal(delivered.length, 0);
  });
}
test('explicitly includes subagents when enabled', async () => {
  const { handler, delivered } = setup({ includeSubagents: true }); await handler(session({ parentSession: 'p' }), end());
  assert.equal(delivered.length, 1);
});
test('default payload falls back when no title or text exists and respects sound setting', async () => {
  const { handler, delivered } = setup({ sound: false });
  await handler({ ...session(), deriveMessages() { throw Error('must not read conversation'); } }, end());
  assert.deepEqual(delivered[0], { title: 'DSH · 响应完成', body: '本轮回复已完成', sound: false });
});
test('disable switch and unload prevent notifications', async () => {
  const disabled = setup({ enabled: false }); await disabled.handler(session(), end()); assert.equal(disabled.delivered.length, 0);
  const unloaded = setup(); unloaded.controller.abort(); await unloaded.handler(session(), end()); assert.equal(unloaded.delivered.length, 0);
});
test('concurrent duplicate is suppressed even before delivery settles', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; }); const { handler, delivered } = setup({}, () => gate); const s = session();
  const p = handler(s, end()); await handler(s, end()); release(); await p; assert.equal(delivered.length, 1);
});
test('transport failure is contained and reported without logging payload', async () => {
  const { handler, errors } = setup({}, async () => { throw Object.assign(Error('private text'), { code: 'ENOENT' }); });
  await handler(session(), end()); assert.deepEqual(errors, ['ENOENT']);
});
test('rejects unknown configuration and invalid booleans', () => {
  assert.throws(() => normalizeConfig({ sound: 'false' })); assert.throws(() => normalizeConfig({ command: 'anything' }));
});
function context() {
  const listeners = new Map(), cleanups = [], warnings = [];
  return { listeners, cleanups, warnings,
    on(name, listener) { listeners.set(name, listener); },
    effect(factory) { cleanups.push(factory()); },
    logger() { return { warn(message) { warnings.push(message); } }; }
  };
}
test('unrelated event bursts cannot occupy notification delivery capacity', async () => {
  const ctx = context(), delivered = [];
  mountCompletionNotifications(ctx, {}, async payload => { delivered.push(payload); });
  const receive = ctx.listeners.get('session/event'); const s = session();
  for (let i = 0; i < 100; i++) receive(s, { type: 'assistant/message' });
  receive(s, end());
  await ctx.cleanups[0]();
  assert.equal(delivered.length, 1);
});
test('mounted observer contains unexpected rejections without unhandled promises', async () => {
  const ctx = context();
  mountCompletionNotifications(ctx, {}, async () => {});
  ctx.listeners.get('session/event')({ id: 'invalid', firstLiveSeq: 0 }, end());
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(ctx.warnings.some(w => w.includes('INVALID_EVENT')));
  await ctx.cleanups[0]();
});
test('mount bounds native deliveries and unloads aborts and waits for them', async () => {
  const ctx = context(); let calls = 0; const signals = [];
  mountCompletionNotifications(ctx, {}, async (_payload, { signal }) => {
    calls++; signals.push(signal);
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
  });
  const receive = ctx.listeners.get('session/event');
  for (let i = 0; i < 20; i++) receive(session(), end());
  assert.equal(calls, 8);
  assert.ok(ctx.warnings.some(w => w.includes('capacity')));
  await ctx.cleanups[0]();
  assert.equal(signals.every(s => s.aborted), true);
  receive(session(), end()); assert.equal(calls, 8);
});
test('mounted delivery failure is contained and capacity becomes reusable', async () => {
  const ctx = context(); let calls = 0;
  mountCompletionNotifications(ctx, {}, async () => { calls++; throw Object.assign(Error('secret'), { code: 'ENOENT' }); });
  const receive = ctx.listeners.get('session/event'); receive(session(), end());
  await new Promise(resolve => setImmediate(resolve));
  receive(session(), end()); await ctx.cleanups[0]();
  assert.equal(calls, 2); assert.ok(ctx.warnings[0].includes('ENOENT')); assert.equal(ctx.warnings[0].includes('secret'), false);
});
test('native transport refuses unsupported OS without executing anything', async () => {
  await assert.rejects(sendNativeNotification({ title: 'x', body: 'y' }, { platform: 'linux' }), { code: 'UNSUPPORTED_PLATFORM' });
});
test('native transport sends through the prepared notifier binary with user text only as argv', async () => {
  const text = '" & do shell script "touch /tmp/NEVER"; $(bad)\n你好'; let call;
  const result = await sendNativeNotification({ title: text, body: text, sound: true }, {
    platform: 'darwin', ensureNotifier: async () => '/notifier/DSH Notify.app/Contents/MacOS/dsh-notify',
    execute(file, args, options, callback) { call = { file, args, options }; callback(null, '', ''); }
  });
  assert.equal(call.file, '/notifier/DSH Notify.app/Contents/MacOS/dsh-notify');
  // Untrusted text travels only as arguments, never compiled or interpolated.
  assert.deepEqual(call.args, [text, text, 'true']);
  assert.equal(call.options.shell, false);
  assert.equal(call.options.timeout, 8000);
  assert.deepEqual(result, { status: 'submitted', via: 'notifier' });
});
test('native transport falls back to osascript when no notifier can be prepared', async () => {
  const text = 'secret"; danger'; const calls = [];
  const result = await sendNativeNotification({ title: text, body: text, sound: false }, {
    platform: 'darwin', ensureNotifier: async () => { throw Error('build failed'); },
    execute(file, args, options, callback) { calls.push({ file, args }); callback(null, '', ''); }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, '/usr/bin/osascript');
  assert.equal(calls[0].args[0], '-e');
  assert.equal(calls[0].args[1].includes(text), false);
  assert.deepEqual(calls[0].args.slice(2), ['--', text, text, 'false']);
  assert.deepEqual(result, { status: 'submitted', via: 'osascript' });
});
test('notifier that cannot launch (ENOENT) degrades to the osascript fallback', async () => {
  const calls = [];
  const result = await sendNativeNotification({ title: 't', body: 'b', sound: false }, {
    platform: 'darwin', ensureNotifier: async () => '/gone/dsh-notify',
    execute(file, args, options, callback) {
      calls.push(file);
      file === '/gone/dsh-notify' ? callback(Object.assign(Error('spawn'), { code: 'ENOENT' })) : callback(null, '', '');
    }
  });
  assert.deepEqual(calls, ['/gone/dsh-notify', '/usr/bin/osascript']);
  assert.equal(result.via, 'osascript');
});
test('started notifier failure stays at-most-once without a second delivery', async () => {
  let calls = 0;
  await assert.rejects(sendNativeNotification({ title: 't', body: 'b', sound: false }, {
    platform: 'darwin', ensureNotifier: async () => '/dsh-notify',
    execute(file, args, options, callback) { calls++; callback(Object.assign(Error('auth denied'), { code: 69 })); }
  }), { code: 69 });
  assert.equal(calls, 1);
});
test('notifier launch permission errors also degrade to the osascript fallback', async () => {
  for (const code of ['EACCES', 'EPERM']) {
    let fellBack = false;
    const result = await sendNativeNotification({ title: 't', body: 'b', sound: false }, {
      platform: 'darwin', ensureNotifier: async () => '/dsh-notify',
      execute(file, args, options, callback) {
        if (file === '/dsh-notify') callback(Object.assign(Error(code), { code }));
        else { fellBack = true; callback(null, '', ''); }
      }
    });
    assert.equal(fellBack, true);
    assert.equal(result.via, 'osascript');
  }
});
