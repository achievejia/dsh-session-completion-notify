import { execFile } from 'node:child_process';

// Fallback when the notifier .app cannot be built or launched (no swiftc,
// build failed): a plain display notification attributed to Script Editor.
// The script source is a constant; user text travels only as argv.
const FALLBACK_SCRIPT = `on run argv
  set nTitle to item 1 of argv
  set nBody to item 2 of argv
  set nSound to item 3 of argv
  if nSound is "true" then
    display notification nBody with title nTitle sound name "Glass"
  else
    display notification nBody with title nTitle
  end if
end run`;

const exec = (execute, file, args, signal) => new Promise((resolve, reject) => {
  execute(file, args, { shell: false, timeout: 8000, maxBuffer: 8192, signal }, error => error ? reject(error) : resolve());
});

export async function sendNativeNotification(payload, { signal, platform = process.platform, execute = execFile, ensureNotifier } = {}) {
  if (platform !== 'darwin') throw Object.assign(new Error('Native notifications require macOS'), { code: 'UNSUPPORTED_PLATFORM' });
  const args = [payload.title, payload.body, String(!!payload.sound)];
  let notifierPath;
  try {
    notifierPath = await ensureNotifier?.();
  } catch { /* build failure degrades to the Script Editor fallback below */ }
  if (notifierPath) {
    try {
      await exec(execute, notifierPath, args, signal);
      return { status: 'submitted', via: 'notifier' };
    } catch (error) {
      // 68=budget exceeded, 69=authorization denied, 70=post error: the notifier
      // ran and reported a real delivery problem — no second attempt (at-most-once).
      if ([68, 69, 70].includes(error?.code)) throw error;
      // Fall back only when the notifier never launched.
      if (!['ENOENT', 'EACCES', 'EPERM'].includes(error?.code)) throw error;
    }
  }
  await exec(execute, '/usr/bin/osascript', ['-e', FALLBACK_SCRIPT, '--', ...args], signal);
  return { status: 'submitted', via: 'osascript' };
}
