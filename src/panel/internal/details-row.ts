import type { FieldConfig } from '../../shared/types.js';
import { isComplexValue } from './helpers.js';
import { COPY_BTN_RESET_MS } from './constants.js';

export interface DetailContent {
  content: string;
  kind: 'json' | 'text';
}

// Decide how to render the value of a field marked `showAsDetail: true`.
// `null`/`undefined` → no detail row at all.
// Objects/arrays → pretty-printed JSON.
// Strings that look like JSON → parsed & pretty-printed; otherwise plain text.
// `stack_trace` is the one built-in field always rendered as plain multi-line
// text by default — log frameworks emit it as a newline-delimited backtrace,
// not JSON.
export function buildDetailContent(f: FieldConfig, v: unknown): DetailContent | null {
  if (v === undefined || v === null) return null;
  if (isComplexValue(v)) return { content: JSON.stringify(v, null, 2), kind: 'json' };
  if (typeof v === 'string') {
    if (f.key === 'stack_trace') return { content: v, kind: 'text' };
    const trimmed = v.trim();
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return { content: JSON.stringify(JSON.parse(trimmed), null, 2), kind: 'json' };
      } catch {
        /* fall through */
      }
    }
    return { content: v, kind: 'text' };
  }
  return { content: JSON.stringify(v), kind: 'text' };
}

export function createDetailsRow(
  label: string,
  content: string,
  kind: 'json' | 'text',
  preview: boolean,
): { row: HTMLDivElement; wrap: HTMLDivElement } {
  const row = document.createElement('div');
  row.className = `details-row details-row--${kind}`;
  const wrap = document.createElement('div');
  wrap.className = `details-wrap ${preview ? 'with-preview' : 'no-preview'}`;

  const header = document.createElement('div');
  header.className = 'details-header';
  const lbl = document.createElement('span');
  lbl.className = 'details-label';
  lbl.textContent = label;
  const copyBtn = document.createElement('button');
  copyBtn.className = 'details-copy';
  copyBtn.type = 'button';
  copyBtn.textContent = 'copy';
  copyBtn.title = `Copy ${label}`;
  copyBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    navigator.clipboard.writeText(content).catch(() => {});
    const prev = copyBtn.textContent;
    copyBtn.textContent = 'copied';
    copyBtn.classList.add('copied');
    self.setTimeout(() => {
      copyBtn.textContent = prev;
      copyBtn.classList.remove('copied');
    }, COPY_BTN_RESET_MS);
  });
  header.append(lbl, copyBtn);

  const pre = document.createElement('pre');
  pre.className = 'details-content';
  pre.textContent = content;

  // Click-to-toggle on the entire header and body. Skip the toggle while the
  // user is selecting text — collapsing mid-selection would yank the block
  // out from under them.
  function maybeToggle() {
    const rootNode = pre.getRootNode() as unknown as {
      getSelection?: () => Selection | null;
    };
    const sel =
      typeof rootNode.getSelection === 'function' ? rootNode.getSelection() : window.getSelection();
    if (sel && sel.toString().length > 0) return;
    wrap.classList.toggle('open');
  }
  header.addEventListener('click', maybeToggle);
  pre.addEventListener('click', maybeToggle);

  wrap.append(header, pre);
  row.appendChild(wrap);
  return { row, wrap };
}
