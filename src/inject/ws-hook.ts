import { WIRE_NS, type PageWire } from '../shared/types.js';
import { POD_LOG_URL_RE } from '../shared/parser.js';

(() => {
  if ((window as unknown as { __okdLogHook?: boolean }).__okdLogHook) return;
  (window as unknown as { __okdLogHook?: boolean }).__okdLogHook = true;

  const OrigWS = window.WebSocket;
  let sockCounter = 0;

  function post(msg: PageWire) {
    try {
      window.postMessage(msg, window.location.origin);
    } catch {
      /* ignore */
    }
  }

  function Wrapped(this: WebSocket, url: string | URL, protocols?: string | string[]): WebSocket {
    const urlStr = typeof url === 'string' ? url : url.toString();
    const match = POD_LOG_URL_RE.test(urlStr);
    const ws = protocols !== undefined ? new OrigWS(url, protocols) : new OrigWS(url);
    if (!match) return ws;

    const socketId = ++sockCounter;
    post({ ns: WIRE_NS, type: 'ws-open', socketId, url: urlStr, t: Date.now() });

    ws.addEventListener('open', () => {
      post({ ns: WIRE_NS, type: 'ws-ready', socketId, t: Date.now() });
    });
    ws.addEventListener('message', (ev) => {
      const d = ev.data;
      if (typeof d !== 'string') return;
      post({ ns: WIRE_NS, type: 'ws-msg', socketId, url: urlStr, data: d, t: Date.now() });
    });
    ws.addEventListener('close', (ev) => {
      post({ ns: WIRE_NS, type: 'ws-close', socketId, code: ev.code, t: Date.now() });
    });
    return ws;
  }

  Wrapped.prototype = OrigWS.prototype;
  (Wrapped as unknown as { CONNECTING: number }).CONNECTING = OrigWS.CONNECTING;
  (Wrapped as unknown as { OPEN: number }).OPEN = OrigWS.OPEN;
  (Wrapped as unknown as { CLOSING: number }).CLOSING = OrigWS.CLOSING;
  (Wrapped as unknown as { CLOSED: number }).CLOSED = OrigWS.CLOSED;

  window.WebSocket = Wrapped as unknown as typeof WebSocket;
})();
