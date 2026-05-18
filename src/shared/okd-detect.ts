import type { OkdVariant } from './types.js';

// Path-only detection — never relies on hostname so the extension can be
// dropped onto any OKD instance without code changes.
//
// OKD 3 (Angular console) routes pods under `/console/project/<ns>/browse/pods/<pod>`.
// OKD 4 (React/PatternFly console) routes pods under `/k8s/(ns|cluster|all-namespaces)/<ns>/pods/<pod>[/sub]`.
const OKD3_POD_RE = /^\/console\/project\/[^/]+\/browse\/pods\/[^/?#]+/;
const OKD4_POD_RE = /^\/k8s\/(?:ns|cluster|all-namespaces)\/[^/]+\/pods\/[^/]+(?:\/[^/?#]*)?\/?$/;

export function detectFromUrl(url: string | undefined): OkdVariant | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (OKD3_POD_RE.test(u.pathname)) return 'okd3';
  if (OKD4_POD_RE.test(u.pathname)) return 'okd4';
  return null;
}

export function detectFromWsUrl(url: string): OkdVariant | null {
  // OKD 4 console proxies the apiserver under `/api/kubernetes/...`. OKD 3
  // hits `/api/v1/...` directly. Either way, the WebSocket targets the same
  // pod-log endpoint — distinguish by the proxy prefix only.
  try {
    const u = new URL(url);
    if (/^\/api\/kubernetes\/api\/v1\/namespaces\//.test(u.pathname)) return 'okd4';
    if (/^\/api\/v1\/namespaces\//.test(u.pathname)) return 'okd3';
  } catch {
    /* ignore */
  }
  return null;
}

// Stable identity for a pod page, used to detect when the user navigates
// between pods (vs. tab-switching within the same pod). Empty string means
// the path is not a pod page.
export function extractPodKey(pathname: string): string {
  const m4 = pathname.match(/^\/k8s\/ns\/([^/]+)\/pods\/([^/]+)/);
  if (m4) return `okd4:${m4[1]}:${m4[2]}`;
  const m3 = pathname.match(/^\/console\/project\/([^/]+)\/browse\/pods\/([^/]+)/);
  if (m3) return `okd3:${m3[1]}:${m3[2]}`;
  return '';
}
