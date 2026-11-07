// No historical scans: one post-commit terminal event in, one notification out.
// Title and body composition live in preview.js.
import { buildNotification } from './preview.js';

export function normalizeConfig(raw = {}) {
  const result = { enabled: true, sound: true, includeSubagents: false, showPreview: true, showSessionTitle: true };
  for (const [key, value] of Object.entries(raw)) {
    if (!Object.hasOwn(result, key) || typeof value !== 'boolean') throw new TypeError(`Invalid notification config: ${key}`);
    result[key] = value;
  }
  return result;
}

export function mountCompletionNotifications(ctx, rawConfig, send, getTitle) {
  const config = normalizeConfig(rawConfig);
  const controller = new AbortController();
  const pending = new Set();
  const logger = ctx.logger('session-completion-notify');
  const handler = createCompletionListener({ config, send, signal: controller.signal, getTitle: getTitle ? session => getTitle(session) : undefined,
    onError: code => logger.warn(`System notification not submitted (${code}); check macOS notification settings.`)
  });
  ctx.on('session/event', (session, event) => {
    // Irrelevant event bursts must not consume delivery capacity.
    if (controller.signal.aborted || event?.type !== 'turn/end' || event.data?.reason?.kind !== 'completed') return;
    if (pending.size >= 8) { logger.warn('Notification skipped: delivery capacity reached.'); return; }
    const task = handler(session, event);
    pending.add(task);
    void task.then(() => pending.delete(task), () => {
      pending.delete(task);
      logger.warn('Notification observer failed (INVALID_EVENT); session contents omitted.');
    });
  });
  ctx.effect(() => async () => {
    controller.abort();
    await Promise.allSettled([...pending]);
  }, 'session-completion-notify: delivery lifetime');
}

export function createCompletionListener({ config, send, signal, onError = () => {}, getTitle }) {
  // Weak keys let disposed sessions go; high-water marks prevent concurrent duplicate submissions.
  const seen = new WeakMap();
  return async (session, event) => {
    if (!config.enabled || signal.aborted || event.type !== 'turn/end' || event.data?.reason?.kind !== 'completed') return;
    if (!Number.isInteger(event.seq) || event.seq < session.firstLiveSeq) return;
    const header = session.header;
    if (!config.includeSubagents && (header.parentSession || header.origin === 'subagent' || header.delegationDepth > 0)) return;
    if (event.seq <= (seen.get(session) ?? -1)) return;
    seen.set(session, event.seq);
    try {
      await send(buildNotification(session, event, config, () => getTitle?.(session)), { signal });
    } catch (error) {
      if (!signal.aborted) onError(/^[A-Z0-9_]+$/.test(error?.code ?? '') ? error.code : 'DELIVERY_FAILED');
    }
  };
}
