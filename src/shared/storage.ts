import { DEFAULT_CONFIG, type Config } from './types.js';

// Settings are isolated per OKD instance so two consoles in chrome.storage.sync
// don't share field lists, level colors, etc. We never store the hostname
// itself — instead we hash `location.origin` into a stable opaque fingerprint
// and key the config under that. Two installs of the same extension on the
// same origin produce the same fingerprint; different origins can't be
// reverse-correlated from the stored key without already knowing them.
const LEGACY_KEY = 'config';
const FINGERPRINT_PREFIX = 'cfg:';
const HOSTNAME_LEAK_PREFIX = 'config:'; // keys written by an earlier build

let fingerprintPromise: Promise<string> | null = null;

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  let out = '';
  for (const b of new Uint8Array(buf)) out += b.toString(16).padStart(2, '0');
  return out;
}

function getFingerprint(): Promise<string> {
  if (!fingerprintPromise) {
    const seed = typeof location !== 'undefined' && location.origin ? location.origin : 'unknown';
    fingerprintPromise = sha256Hex(seed).then((h) => h.slice(0, 24));
  }
  return fingerprintPromise;
}

async function fingerprintKey(): Promise<string> {
  return FINGERPRINT_PREFIX + (await getFingerprint());
}

// One-shot housekeeping: remove any keys an earlier build wrote under
// `config:<hostname>` so chrome.storage.sync doesn't keep raw hostnames.
let cleanupDone = false;
async function cleanupLegacyHostnameKeys(): Promise<void> {
  if (cleanupDone) return;
  cleanupDone = true;
  try {
    const all = await chrome.storage.sync.get(null);
    const stale = Object.keys(all).filter((k) => k.startsWith(HOSTNAME_LEAK_PREFIX));
    if (stale.length > 0) await chrome.storage.sync.remove(stale);
  } catch {
    /* best-effort */
  }
}

export async function getConfig(): Promise<Config> {
  const key = await fingerprintKey();
  const raw = await chrome.storage.sync.get([key, LEGACY_KEY]);
  // Seed from the legacy unscoped 'config' the first time we see this origin —
  // gives existing users a smooth handoff. After we save once under the
  // fingerprint key, the seed branch is never taken again for this origin.
  const stored = (raw[key] ?? raw[LEGACY_KEY]) as Partial<Config> | undefined;
  void cleanupLegacyHostnameKeys();
  if (!stored) return { ...DEFAULT_CONFIG };
  // Forward-compat migration: stack_trace defaults to detail+preview, so
  // configs saved by earlier versions (no showAsDetail flag) shouldn't
  // suddenly start rendering stack traces inline.
  const fields = (stored.fields ?? DEFAULT_CONFIG.fields).map((f) => {
    if (f.key === 'stack_trace' && f.showAsDetail === undefined) {
      return { ...f, showAsDetail: true, detailPreview: f.detailPreview ?? true };
    }
    return f;
  });
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    fields,
    levelColors: { ...DEFAULT_CONFIG.levelColors, ...(stored.levelColors ?? {}) },
    // Search text is intentionally a session-only filter — never restore it
    // from storage even if a previous build wrote it there.
    filters: { ...DEFAULT_CONFIG.filters, ...(stored.filters ?? {}), search: '' },
  };
}

export async function setConfig(cfg: Config): Promise<void> {
  // Force search to '' on write so it doesn't survive a reload nor sync to
  // other tabs.
  const sanitized: Config = {
    ...cfg,
    filters: { ...cfg.filters, search: '' },
  };
  const key = await fingerprintKey();
  await chrome.storage.sync.set({ [key]: sanitized });
}

export function onConfigChange(cb: (cfg: Config) => void): () => void {
  let myKey: string | null = null;
  getFingerprint().then((fp) => {
    myKey = FINGERPRINT_PREFIX + fp;
  });
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'sync') return;
    if (!myKey || !(myKey in changes)) return;
    getConfig()
      .then(cb)
      .catch(() => {});
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
