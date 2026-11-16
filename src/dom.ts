// Tiny DOM helpers shared by the page modules.

export const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

/** Escapes text for use inside HTML strings. */
export const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Icons for check results (the filter check and the video checks use the same list style). */
export const ICON = { ok: '✓', fixed: '✎', note: 'i', error: '✕' } as const;
