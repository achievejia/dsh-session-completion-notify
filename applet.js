// Builds the notifier .app once per machine: a tiny Swift UNUserNotificationCenter
// tool bundled with DeepSeek Harness's icon and display name, so banners carry
// the app icon and the notification center entry reads "DeepSeek Harness".
// Ad-hoc applets never register with the notification center on modern macOS
// and their display-notification XPC call hangs forever — this path replaces them.
import { execFile } from 'node:child_process';
import { copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_NOTIFIER_DIR = join(homedir(), '.dsh', 'session-completion-notify');
export const DEFAULT_ICON_PATH = '/Applications/DeepSeek Harness.app/Contents/Resources/icon.icns';
const APP_NAME = 'DSH Notify.app';
const BUNDLE_ID = 'com.deepseek.dsh.notifier';

const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>DeepSeek Harness</string>
  <key>CFBundleDisplayName</key><string>DeepSeek Harness</string>
  <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>dsh-notify</string>
  <key>CFBundleIconFile</key><string>applet.icns</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
  <key>NSUserNotificationUsageDescription</key><string>DSH 会在每轮会话回复完成时发送系统通知。</string>
 </dict>
</plist>`;

const run = (execute, file, args, timeout = 15000) => new Promise((resolve, reject) => {
  execute(file, args, { shell: false, timeout, maxBuffer: 8192 }, error => error ? reject(error) : resolve());
});

export async function buildNotifierApp({ notifierDir = DEFAULT_NOTIFIER_DIR, iconPath = DEFAULT_ICON_PATH, execute = execFile } = {}) {
  const appPath = join(notifierDir, APP_NAME);
  const binary = join(appPath, 'Contents', 'MacOS', 'dsh-notify');
  // Rebuild when missing or older than the shipped Swift source (version upgrades).
  const sourcePath = join(dirname(fileURLToPath(import.meta.url)), 'swift-notify.swift');
  if (existsSync(binary)) {
    try {
      const binStats = await stat(binary);
      const srcStats = await stat(sourcePath);
      if (srcStats.mtimeMs > binStats.mtimeMs) await rm(appPath, { recursive: true, force: true });
    } catch { /* stale check must never block delivery */ }
  }
  if (existsSync(binary)) return binary;
  // Clean build: never mix a fresh notifier with leftovers of an older layout.
  await rm(appPath, { recursive: true, force: true });
  await mkdir(join(appPath, 'Contents', 'MacOS'), { recursive: true });
  await mkdir(join(appPath, 'Contents', 'Resources'), { recursive: true });
  await copyFile(sourcePath, join(appPath, 'Contents', 'Resources', 'swift-notify.swift'));
  await run(execute, '/usr/bin/swiftc', ['-O', join(appPath, 'Contents', 'Resources', 'swift-notify.swift'), '-o', binary], 120000);
  // Icon is cosmetic identity; delivery works without it.
  try { await copyFile(iconPath, join(appPath, 'Contents', 'Resources', 'applet.icns')); } catch { /* keep default */ }
  await writeFile(join(appPath, 'Contents', 'Info.plist'), INFO_PLIST, 'utf8');
  await run(execute, '/usr/bin/codesign', ['--force', '--sign', '-', appPath]);
  if (!existsSync(binary)) throw Object.assign(new Error('Notifier binary missing after build'), { code: 'NOTIFIER_BUILD_FAILED' });
  return binary;
}
