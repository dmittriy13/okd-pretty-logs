import type { Config, FieldConfig } from '../shared/types.js';
import { DEFAULT_CONFIG } from '../shared/types.js';

export interface SettingsUI {
  open(): void;
  close(): void;
  setDiscoveredFields(fields: string[]): void;
  refresh(config: Config): void;
}

export interface InitSettingsOpts {
  drawer: HTMLElement;
  fieldsList: HTMLUListElement;
  levelColorsList: HTMLUListElement;
  ringInput: HTMLInputElement;
  tsPatternInput: HTMLInputElement;
  closeBtn: HTMLButtonElement;
  resetBtn: HTMLButtonElement;
  getConfig: () => Config;
  saveConfig: (c: Config) => void;
}

export function initSettings(opts: InitSettingsOpts): SettingsUI {
  const {
    drawer,
    fieldsList,
    levelColorsList,
    ringInput,
    tsPatternInput,
    closeBtn,
    resetBtn,
    getConfig,
    saveConfig,
  } = opts;
  let discoveredFields: string[] = [];

  function updateField(key: string, patch: Partial<FieldConfig>) {
    const next = structuredClone(getConfig());
    const idx = next.fields.findIndex((x) => x.key === key);
    if (idx >= 0) {
      next.fields[idx] = { ...next.fields[idx]!, ...patch };
    } else {
      next.fields.push({ key, visible: false, ...patch });
    }
    saveConfig(next);
  }

  function renderFields(config: Config) {
    fieldsList.textContent = '';
    const knownKeys = new Set(config.fields.map((f) => f.key));
    const extra = discoveredFields.filter((k) => !knownKeys.has(k));
    const all: FieldConfig[] = [...config.fields, ...extra.map((key) => ({ key, visible: false }))];

    for (let i = 0; i < all.length; i++) {
      const f = all[i]!;
      const li = document.createElement('li');
      li.dataset.index = String(i);

      const header = document.createElement('div');
      header.className = 'field-row__header';

      // Only the handle is the drag source so dragging from a checkbox or
      // the pattern text input doesn't initiate a reorder.
      const handle = document.createElement('span');
      handle.className = 'handle';
      handle.draggable = true;
      handle.setAttribute('role', 'button');
      handle.setAttribute('aria-label', 'Drag to reorder');
      handle.textContent = '⋮⋮';
      header.appendChild(handle);

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = f.visible;
      cb.title = 'Visible';
      cb.addEventListener('change', () => updateField(f.key, { visible: cb.checked }));
      header.appendChild(cb);

      const name = document.createElement('span');
      name.className = 'field-name';
      name.textContent = f.key;
      header.appendChild(name);

      li.appendChild(header);

      const opts = document.createElement('div');
      opts.className = 'field-row__opts';

      // Two clearly separated sub-rows: inline-mode controls on top, detail-
      // mode controls underneath. Whichever group isn't active is dimmed
      // and click-blocked so the layout reads as "exclusive modes".
      const inlineGroup = document.createElement('div');
      inlineGroup.className = 'field-opt-group field-opt-group--inline';

      const patternWrap = document.createElement('label');
      patternWrap.className = 'field-opt pattern-opt';
      const patternLabel = document.createElement('span');
      patternLabel.textContent = 'Shortenable pattern';
      patternLabel.title = 'Pattern like ####*#### keeps 4 head + 4 tail chars, elides the middle';
      const patternInput = document.createElement('input');
      patternInput.type = 'text';
      patternInput.spellcheck = false;
      patternInput.value = f.shortPattern ?? '';
      patternInput.addEventListener('change', () =>
        updateField(f.key, { shortPattern: patternInput.value || undefined }),
      );
      patternWrap.append(patternLabel, patternInput);
      inlineGroup.appendChild(patternWrap);

      // Sub-row for the two click-action checkboxes — visually separated
      // from the pattern input, which sits on its own row above.
      const chkRow = document.createElement('div');
      chkRow.className = 'field-opt-row';

      const copyWrap = document.createElement('label');
      copyWrap.className = 'field-opt chk-opt';
      copyWrap.title = 'Click cell to copy its value to the clipboard';
      const copyCb = document.createElement('input');
      copyCb.type = 'checkbox';
      copyCb.checked = f.copyOnClick === true;
      copyCb.addEventListener('change', () =>
        updateField(f.key, { copyOnClick: copyCb.checked || undefined }),
      );
      copyWrap.append(copyCb, document.createTextNode(' copyable'));
      chkRow.appendChild(copyWrap);

      const searchWrap = document.createElement('label');
      searchWrap.className = 'field-opt chk-opt';
      searchWrap.title = 'Click cell to insert its value into the search box';
      const searchCb = document.createElement('input');
      searchCb.type = 'checkbox';
      searchCb.checked = f.searchOnClick === true;
      searchCb.addEventListener('change', () =>
        updateField(f.key, { searchOnClick: searchCb.checked || undefined }),
      );
      searchWrap.append(searchCb, document.createTextNode(' filterable'));
      chkRow.appendChild(searchWrap);

      inlineGroup.appendChild(chkRow);

      opts.appendChild(inlineGroup);

      const detailGroup = document.createElement('div');
      detailGroup.className = 'field-opt-group field-opt-group--detail';

      const detailWrap = document.createElement('label');
      detailWrap.className = 'field-opt chk-opt';
      detailWrap.title = 'Render this field as an expandable sub-row instead of an inline cell';
      const detailCb = document.createElement('input');
      detailCb.type = 'checkbox';
      detailCb.checked = f.showAsDetail === true;
      detailWrap.append(detailCb, document.createTextNode(' detail'));
      detailGroup.appendChild(detailWrap);

      const previewWrap = document.createElement('label');
      previewWrap.className = 'field-opt chk-opt preview-opt';
      previewWrap.title = 'Show a short preview of the value when the sub-row is collapsed';
      const previewCb = document.createElement('input');
      previewCb.type = 'checkbox';
      previewCb.checked = f.detailPreview === true;
      previewCb.addEventListener('change', () =>
        updateField(f.key, { detailPreview: previewCb.checked || undefined }),
      );
      previewWrap.append(previewCb, document.createTextNode(' preview'));
      detailGroup.appendChild(previewWrap);

      opts.appendChild(detailGroup);

      function refreshOptDisabled(detailOn: boolean) {
        for (const el of [patternInput, copyCb, searchCb]) el.disabled = detailOn;
        previewCb.disabled = !detailOn;
        inlineGroup.classList.toggle('disabled', detailOn);
        previewWrap.classList.toggle('disabled', !detailOn);
      }
      refreshOptDisabled(detailCb.checked);

      detailCb.addEventListener('change', () => {
        const on = detailCb.checked;
        refreshOptDisabled(on);
        if (on) {
          // Clear inline-mode values when switching to detail — the controls
          // are now disabled, but we don't want stale settings to come back
          // when the user toggles detail off later.
          patternInput.value = '';
          copyCb.checked = false;
          searchCb.checked = false;
          updateField(f.key, {
            showAsDetail: true,
            shortPattern: undefined,
            copyOnClick: undefined,
            searchOnClick: undefined,
          });
        } else {
          // Preview is only meaningful while detail mode is on; clear it.
          previewCb.checked = false;
          updateField(f.key, { showAsDetail: undefined, detailPreview: undefined });
        }
      });

      li.appendChild(opts);

      handle.addEventListener('dragstart', (e) => {
        li.classList.add('dragging');
        // setData is required by Firefox; effectAllowed by Safari for the
        // visual cue. Chrome would work without either but this keeps the
        // behaviour consistent across browsers.
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', f.key);
          // Use the row as the drag image so the user sees what's moving.
          if (typeof e.dataTransfer.setDragImage === 'function') {
            e.dataTransfer.setDragImage(li, 12, 12);
          }
        }
      });
      handle.addEventListener('dragend', () => {
        li.classList.remove('dragging');
        for (const peer of Array.from(fieldsList.children)) {
          peer.classList.remove('drag-over-before', 'drag-over-after');
        }
      });

      li.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        const rect = li.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        li.classList.toggle('drag-over-before', before);
        li.classList.toggle('drag-over-after', !before);
      });
      li.addEventListener('dragleave', () => {
        li.classList.remove('drag-over-before', 'drag-over-after');
      });
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        const rect = li.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        li.classList.remove('drag-over-before', 'drag-over-after');
        const dragging = fieldsList.querySelector<HTMLLIElement>('li.dragging');
        if (!dragging || dragging === li) return;
        const fromIdx = Number(dragging.dataset.index);
        let toIdx = Number(li.dataset.index);
        if (Number.isNaN(fromIdx) || Number.isNaN(toIdx)) return;
        if (!before) toIdx += 1;

        const next = structuredClone(getConfig());
        const merged = [...next.fields, ...extra.map((k) => ({ key: k, visible: false }))];
        const [moved] = merged.splice(fromIdx, 1);
        if (!moved) return;
        // Splicing out fromIdx shifts items above the drop target down by 1.
        const insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx;
        merged.splice(insertAt, 0, moved);
        next.fields = merged;
        saveConfig(next);
      });

      fieldsList.appendChild(li);
    }
  }

  function renderLevelColors(config: Config) {
    levelColorsList.textContent = '';
    const levels = Object.keys({ ...DEFAULT_CONFIG.levelColors, ...config.levelColors });
    for (const lv of levels) {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.className = 'level-label';
      label.textContent = lv;
      const picker = document.createElement('input');
      picker.type = 'color';
      picker.value = config.levelColors[lv] ?? DEFAULT_CONFIG.levelColors[lv] ?? '#888888';
      picker.addEventListener('change', () => {
        const next = structuredClone(getConfig());
        next.levelColors = { ...next.levelColors, [lv]: picker.value };
        saveConfig(next);
      });
      li.appendChild(label);
      li.appendChild(picker);
      levelColorsList.appendChild(li);
    }
  }

  function renderRing(config: Config) {
    ringInput.value = String(config.ringBuffer);
  }

  function renderTsPattern(config: Config) {
    tsPatternInput.value = config.timestampPattern;
  }

  ringInput.addEventListener('change', () => {
    const n = Number(ringInput.value);
    if (!Number.isFinite(n) || n < 100) return;
    const next = structuredClone(getConfig());
    next.ringBuffer = Math.min(50000, Math.max(100, Math.floor(n)));
    saveConfig(next);
  });

  tsPatternInput.addEventListener('change', () => {
    const next = structuredClone(getConfig());
    next.timestampPattern = tsPatternInput.value || DEFAULT_CONFIG.timestampPattern;
    saveConfig(next);
  });

  closeBtn.addEventListener('click', () => {
    drawer.hidden = true;
  });

  resetBtn.addEventListener('click', () => {
    saveConfig(structuredClone(DEFAULT_CONFIG));
  });

  return {
    open() {
      drawer.hidden = false;
      const c = getConfig();
      renderFields(c);
      renderLevelColors(c);
      renderRing(c);
      renderTsPattern(c);
    },
    close() {
      drawer.hidden = true;
    },
    setDiscoveredFields(f) {
      discoveredFields = f;
      if (!drawer.hidden) renderFields(getConfig());
    },
    refresh(c) {
      if (drawer.hidden) return;
      renderFields(c);
      renderLevelColors(c);
      renderRing(c);
      renderTsPattern(c);
    },
  };
}
