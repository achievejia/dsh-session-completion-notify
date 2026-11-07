import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildNotifierApp, DEFAULT_ICON_PATH, DEFAULT_NOTIFIER_DIR } from './applet.js';
import { sendNativeNotification } from './native.js';

// Real-toolchain integration tests: macOS-only, the build path is the feature.
const darwin = process.platform === 'darwin';
const plistGet = (plist, key) => new Promise((resolve, reject) => {
  execFile('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
});

test('builder compiles a real notifier .app with DSH identity, icon and LSUIElement', { skip: !darwin }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-notify-build-'));
  try {
    const binary = await buildNotifierApp({ notifierDir: dir, iconPath: existsSync(DEFAULT_ICON_PATH) ? DEFAULT_ICON_PATH : '/nonexistent.icns' });
    assert.equal(binary, join(dir, 'DSH Notify.app', 'Contents', 'MacOS', 'dsh-notify'));
    assert.equal(existsSync(binary), true);
    const plist = join(dir, 'DSH Notify.app', 'Contents', 'Info.plist');
    assert.equal(await plistGet(plist, 'CFBundleName'), 'DeepSeek Harness');
    assert.equal(await plistGet(plist, 'CFBundleDisplayName'), 'DeepSeek Harness');
    assert.equal(await plistGet(plist, 'CFBundleIdentifier'), 'com.deepseek.dsh.notifier');
    assert.equal(await plistGet(plist, 'LSUIElement'), 'true');
    if (existsSync(DEFAULT_ICON_PATH)) {
      assert.equal((await stat(join(dir, 'DSH Notify.app', 'Contents', 'Resources', 'applet.icns'))).size,
        (await stat(DEFAULT_ICON_PATH)).size);
    }
    // Fresh build wins over a stale binary (source newer than binary triggers rebuild).
    const freshDir = await mkdtemp(join(tmpdir(), 'dsh-notify-fresh-'));
    try {
      await execFile('touch', [join(freshDir, 'marker')]);
      const again = await buildNotifierApp({ notifierDir: dir });
      assert.equal(again, binary);
    } finally { await rm(freshDir, { recursive: true, force: true }); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('built notifier delivers a native notification end to end', { skip: !darwin }, async () => {
  const result = await sendNativeNotification(
    { title: '1104 | 开发 | 通知图标验证', body: 'Swift UNUserNotificationCenter 方案 1.3.0：本条通知应显示 DeepSeek Harness 图标', sound: true },
    { ensureNotifier: () => buildNotifierApp() });
  assert.equal(result.via, 'notifier');
});

test('production notifier directory is the persistent ~/.dsh location', () => {
  assert.equal(DEFAULT_NOTIFIER_DIR.endsWith(join('.dsh', 'session-completion-notify')), true);
});
