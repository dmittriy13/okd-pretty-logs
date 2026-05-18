export const WIRE_NS = 'OKD_LOG_EXT_v1';

export type OkdVariant = 'okd3' | 'okd4';

export type SocketState = 'idle' | 'connecting' | 'open' | 'closed';

export interface PageWireOpen {
  ns: typeof WIRE_NS;
  type: 'ws-open';
  socketId: number;
  url: string;
  t: number;
}

export interface PageWireReady {
  ns: typeof WIRE_NS;
  type: 'ws-ready';
  socketId: number;
  t: number;
}

export interface PageWireMessage {
  ns: typeof WIRE_NS;
  type: 'ws-msg';
  socketId: number;
  url: string;
  data: string;
  t: number;
}

export interface PageWireClose {
  ns: typeof WIRE_NS;
  type: 'ws-close';
  socketId: number;
  code?: number;
  t: number;
}

export type PageWire = PageWireOpen | PageWireReady | PageWireMessage | PageWireClose;

export interface LogLine {
  socketId: number;
  seq: number;
  t: number;
  raw: string;
  parsed: Record<string, unknown> | null;
  level?: string;
  timestamp?: string;
}

export interface FieldConfig {
  key: string;
  visible: boolean;
  width?: number;
  // Pattern of the form "####*####" — head `#`-count, `*` separator,
  // tail `#`-count. Middle elided to `…`. Empty/undefined = no shortening.
  // Only applies in inline mode (ignored when showAsDetail).
  shortPattern?: string;
  // Inline-mode click actions. If both true: plain click searches, shift+click
  // copies. Both ignored when showAsDetail is on.
  copyOnClick?: boolean;
  searchOnClick?: boolean;
  // When true, the field is rendered as an expandable sub-row below the main
  // row instead of as a cell. Object/array values render as sub-rows
  // automatically regardless of this flag.
  showAsDetail?: boolean;
  // Sub-row collapsed behaviour: with preview shows the first ~3 lines of
  // content; without it, only the header is visible until expanded. Only
  // meaningful when the field is rendered as a sub-row.
  detailPreview?: boolean;
}

export interface LevelColors {
  [level: string]: string;
}

export interface Filters {
  search: string;
  levels: string[];
}

export interface Config {
  fields: FieldConfig[];
  levelColors: LevelColors;
  filters: Filters;
  expandStack: boolean;
  autoScroll: boolean;
  ringBuffer: number;
  renderCap: number;
  // Pattern applied to any timestamp field. Tokens: YYYY MM DD HH mm ss SSS Z.
  timestampPattern: string;
  // When true, every cell stays on one line and the log area scrolls
  // horizontally. Default false: long lines wrap inside their column so the
  // panel never grows wider than the host frame.
  wrapLines: boolean;
}

export const DEFAULT_CONFIG: Config = {
  fields: [],
  levelColors: {
    ERROR: '#dc3545',
    WARN: '#ffc107',
    INFO: '#0dcaf0',
    DEBUG: '#6c757d',
    TRACE: '#adb5bd',
  },
  filters: { search: '', levels: [] },
  expandStack: false,
  autoScroll: true,
  ringBuffer: 3000,
  renderCap: 2000,
  timestampPattern: 'YYYY-MM-DD HH:mm:ss.SSS',
  wrapLines: true,
};

export interface PanelSocketStatus {
  state: SocketState;
  url: string | null;
  since: number | null;
  lastLineAt: number | null;
  linesTotal: number;
}
