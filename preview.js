// Codex-style notification copy: session title as the headline, a bounded
// preview of this turn's assistant text as the body. Markdown decoration,
// credentials, local paths, and control characters never reach the OS.

const TITLE_MAX_CHARS = 80;
const BODY_MAX_CHARS = 120;
/** How many event positions before turn/end may be probed for this turn's text. */
const SCAN_WINDOW = 256;

const CREDENTIAL_PATTERNS = [
  [/(?:api[_-]?key|secret|token|password|passwd|pwd|access[_-]?key)\s*[=:]\s*["']?[^\s"']+/gi, '[已隐藏]'],
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [已隐藏]'],
  [/sk-[A-Za-z0-9_-]{8,}/g, '[已隐藏]'],
  [/eyJ[A-Za-z0-9_-]{8,}/g, '[已隐藏]'],
  [/(?:ghp|gho|github_pat)_[A-Za-z0-9_]{8,}/g, '[已隐藏]']
];
const PATH_PATTERN = /(?:\/(?:Users|home|var|private|opt|etc|tmp)\b\/|~\/)[^\s"'）)]*/g;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** Truncate by Unicode code points, appending one ellipsis character. */
export function clampText(text, maxChars) {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  return chars.slice(0, maxChars - 1).join('') + '…';
}

/** Sanitize untrusted model output into one flat notification line. */
export function previewText(text, maxChars) {
  let value = typeof text === 'string' ? text : '';
  value = value
    .replace(/```[\s\S]*?```/g, ' ')   // fenced code blocks wholesale
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images wholesale
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links keep label only
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(CONTROL_CHARS, '')
    .replace(PATH_PATTERN, '[路径已隐藏]');
  for (const [pattern, replacement] of CREDENTIAL_PATTERNS) value = value.replace(pattern, replacement);
  value = value.replace(/[\s\u00A0]+/g, ' ').trim();
  return clampText(value, maxChars);
}

/** True when one message holds assistant text worth previewing. */
function isPreviewCandidate(event, turn) {
  if (event?.type !== 'assistant/message' || event.data?.turn !== turn) return false;
  if (event.data.interrupted === true) return false;
  const blocks = event.data.message?.content;
  if (!Array.isArray(blocks)) return false;
  const hasText = blocks.some(block => block?.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0);
  const isToolCall = blocks.some(block => block?.type === 'tool-call');
  return hasText && !isToolCall;
}

/** This turn's committed assistant text: probe at most SCAN_WINDOW positions back, never earlier logs. */
function latestTurnText(session, event) {
  const turn = event.data?.turn;
  if (!Number.isInteger(turn) || typeof session?.eventAt !== 'function') return undefined;
  const floor = Number.isInteger(session.firstLiveSeq) ? session.firstLiveSeq : 0;
  for (let seq = event.seq - 1, scanned = 0; seq >= floor && scanned < SCAN_WINDOW; seq--, scanned++) {
    let candidate;
    try { candidate = session.eventAt(seq); } catch { return undefined; }
    if (isPreviewCandidate(candidate, turn)) {
      return candidate.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join(' ');
    }
  }
  return undefined;
}

/**
 * Compose the notification payload for one completed turn.
 * @param getTitle - optional () => string; failures fall back to the fixed title.
 */
export function buildNotification(session, event, config, getTitle) {
  let title;
  if (config.showSessionTitle) {
    try {
      const raw = getTitle?.();
      title = typeof raw === 'string' && raw.trim().length > 0 ? previewText(raw, TITLE_MAX_CHARS) : undefined;
    } catch { /* title is decoration; completion still notifies */ }
  }
  let body;
  if (config.showPreview) {
    const raw = latestTurnText(session, event);
    if (typeof raw === 'string' && raw.trim().length > 0) body = previewText(raw, BODY_MAX_CHARS);
  } else {
    const id = String(session?.id ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(-8);
    const turn = Number.isInteger(event.data?.turn) ? event.data.turn : '?';
    body = `会话 ${id} 的第 ${turn} 轮回复已完成`;
  }
  return {
    title: title?.length > 0 ? title : 'DSH · 响应完成',
    body: body?.length > 0 ? body : '本轮回复已完成',
    sound: config.sound
  };
}
