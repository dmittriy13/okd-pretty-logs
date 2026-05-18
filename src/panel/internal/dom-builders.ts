// Pure DOM builders for the panel's static structure. Each function takes the
// host element and populates it; returns a record of named child references
// that the caller wires up.

export interface SettingsDrawerParts {
  closeBtn: HTMLButtonElement;
  fieldsList: HTMLUListElement;
  levelColorsList: HTMLUListElement;
  ringInput: HTMLInputElement;
  tsPatternInput: HTMLInputElement;
  resetBtn: HTMLButtonElement;
}

export function buildSettingsDrawer(drawer: HTMLElement): SettingsDrawerParts {
  const header = el('header', { className: 'settings-header' });
  header.append(el('h2', { textContent: 'Settings' }));
  const closeBtn = el('button', { textContent: '✕' }) as HTMLButtonElement;
  closeBtn.title = 'Close';
  closeBtn.dataset.close = '';
  header.append(closeBtn);

  const fieldsSection = el('section');
  fieldsSection.append(el('h3', { textContent: 'Fields' }));
  const fieldsList = el('ul', { className: 'fields-list' }) as HTMLUListElement;
  fieldsList.dataset.fields = '';
  fieldsSection.append(fieldsList);
  const fieldsHint = el('p', { className: 'hint' });
  fieldsHint.append(document.createTextNode('Drag to reorder. Pattern examples: '));
  fieldsHint.append(el('code', { textContent: '####*####' }));
  fieldsHint.append(
    document.createTextNode(
      ' keeps 4+4 chars, middle elided to …. Click actions turn a cell into a shortcut: search filters by the cell value; copy writes it to the clipboard. If both are on, plain click searches and shift+click copies.',
    ),
  );
  fieldsSection.append(fieldsHint);

  const tsSection = el('section');
  tsSection.append(el('h3', { textContent: 'Timestamp format' }));
  const tsLabel = el('label');
  tsLabel.append(document.createTextNode('Pattern '));
  const tsPatternInput = el('input') as HTMLInputElement;
  tsPatternInput.type = 'text';
  tsPatternInput.spellcheck = false;
  tsPatternInput.dataset.tsPattern = '';
  tsLabel.append(tsPatternInput);
  tsSection.append(tsLabel);
  const tsHint = el('p', { className: 'hint' });
  tsHint.append(document.createTextNode('Tokens: '));
  tsHint.append(el('code', { textContent: 'YYYY MM DD HH mm ss SSS Z' }));
  tsHint.append(document.createTextNode('. Default '));
  tsHint.append(el('code', { textContent: 'YYYY-MM-DD HH:mm:ss.SSS' }));
  tsHint.append(document.createTextNode('.'));
  tsSection.append(tsHint);

  const colorsSection = el('section');
  colorsSection.append(el('h3', { textContent: 'Level colors' }));
  const levelColorsList = el('ul', { className: 'level-colors-list' }) as HTMLUListElement;
  levelColorsList.dataset.levelColors = '';
  colorsSection.append(levelColorsList);

  const bufferSection = el('section');
  bufferSection.append(el('h3', { textContent: 'Buffer size' }));
  const bufferLabel = el('label');
  bufferLabel.append(document.createTextNode('Keep last '));
  const ringInput = el('input') as HTMLInputElement;
  ringInput.type = 'number';
  ringInput.min = '100';
  ringInput.max = '50000';
  ringInput.step = '100';
  ringInput.dataset.ring = '';
  bufferLabel.append(ringInput);
  bufferLabel.append(document.createTextNode(' lines'));
  bufferSection.append(bufferLabel);

  const actionsSection = el('section', { className: 'settings-actions' });
  const resetBtn = el('button', {
    className: 'reset-btn',
    textContent: 'Reset to defaults',
  }) as HTMLButtonElement;
  resetBtn.type = 'button';
  resetBtn.title = 'Restore all settings to defaults';
  resetBtn.dataset.reset = '';
  actionsSection.append(resetBtn);

  drawer.append(header, fieldsSection, tsSection, colorsSection, bufferSection, actionsSection);
  return { closeBtn, fieldsList, levelColorsList, ringInput, tsPatternInput, resetBtn };
}

export interface FooterParts {
  connDot: HTMLSpanElement;
  connState: HTMLSpanElement;
  connUrl: HTMLSpanElement;
  reconnectBtn: HTMLButtonElement;
  rateStat: HTMLSpanElement;
  counts: HTMLSpanElement;
  activity: HTMLSpanElement;
}

export function buildFooter(footer: HTMLElement): FooterParts {
  const left = el('div', { className: 'status-left' });
  const connDot = el('span', { className: 'conn-dot conn-idle' }) as HTMLSpanElement;
  connDot.title = 'WebSocket state';
  const connState = el('span', { className: 'conn-state', textContent: 'idle' }) as HTMLSpanElement;
  const connUrl = el('span', { className: 'conn-url' }) as HTMLSpanElement;
  connUrl.title = '';
  const reconnectBtn = el('button', {
    className: 'reconnect-btn',
    textContent: '↻ reconnect',
  }) as HTMLButtonElement;
  reconnectBtn.type = 'button';
  reconnectBtn.hidden = true;
  reconnectBtn.title = 'Re-request the log stream from OKD';
  left.append(connDot, connState, connUrl, reconnectBtn);

  const right = el('div', { className: 'status-right' });
  const rateStat = el('span', { className: 'stat', textContent: '0 l/s' }) as HTMLSpanElement;
  const counts = el('span', { className: 'stat', textContent: '0 / 0' }) as HTMLSpanElement;
  const activity = el('span', { className: 'activity' }) as HTMLSpanElement;
  activity.title = 'Frames streaming';
  activity.append(el('span'), el('span'), el('span'));
  right.append(rateStat, counts, activity);

  footer.append(left, right);
  return { connDot, connState, connUrl, reconnectBtn, rateStat, counts, activity };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: { className?: string; textContent?: string },
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props?.className) node.className = props.className;
  if (props?.textContent !== undefined) node.textContent = props.textContent;
  return node;
}
