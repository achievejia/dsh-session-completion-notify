import z from '@deepseek-ai/schemastery';
import { mountCompletionNotifications } from './core.js';
import { sendNativeNotification } from './native.js';
import { buildNotifierApp } from './applet.js';

export const name = 'session-completion-notify';
export const Config = z.object({
  enabled: z.boolean().default(true).description('完成通知总开关'),
  sound: z.boolean().default(true).description('使用系统 Glass 提示音'),
  includeSubagents: z.boolean().default(false).description('同时通知子代理/队友的每轮完成（可能产生大量通知）'),
  showPreview: z.boolean().default(true).description('正文显示本轮回复摘要（脱敏+截断，替代固定文案）'),
  showSessionTitle: z.boolean().default(true).description('标题使用会话标题（无标题时回退固定标题）')
});

export function apply(ctx, config) {
  if (process.platform !== 'darwin') {
    ctx.logger('session-completion-notify').warn('Native notification is unavailable: macOS required.');
    return;
  }
  // Lazily built once per machine; a failed build retries on the next turn.
  let notifierPromise;
  const ensureNotifier = () => {
    notifierPromise ??= buildNotifierApp().catch(error => { notifierPromise = undefined; throw error; });
    return notifierPromise;
  };
  const send = (payload, options) => sendNativeNotification(payload, { ...options, ensureNotifier });
  // Optional title service: absent (headless/ACP profiles) degrades to the fixed title.
  const titleService = ctx.get?.('sessionTitle');
  mountCompletionNotifications(
    ctx,
    config,
    send,
    titleService ? session => titleService.get(session)?.title : undefined
  );
}
