// Centralised constants for the panel view. Names track usage sites in
// panel-view.ts and its helper modules; do not inline.

// Row-height estimates fed into the virtualizer before a real measurement
// is available from the ResizeObserver pass.
export const ROW_INLINE_ESTIMATE = 22;
export const ROW_DETAIL_HEADER_ESTIMATE = 18;
export const ROW_DETAIL_PREVIEW_ESTIMATE = 60;
export const ROW_RAW_LINE_ESTIMATE = 18;

// Virtualizer keeps this many pixels of rows mounted above and below the
// visible viewport so a smooth scroll never reveals an unmounted region.
export const OVERSCAN_PX = 240;

// Column-width pins. MIN_WIDTH_CH keeps every track wide enough that an empty
// cell still shows the column boundary; WRAP_CAP_CH caps non-stretcher tracks
// in wrap mode so a single very long value can't squeeze the stretcher.
export const MIN_WIDTH_CH = 3;
export const WRAP_CAP_CH = 80;

// `.col` cells have 6px horizontal padding on each side (see shadow.css).
// Grid tracks size the cell's outer border-box, so we add the total padding
// back via calc() to preserve the predicted content width.
export const COL_HORIZONTAL_PADDING_PX = 12;

// UI timings.
export const FLASH_COPIED_MS = 450;
export const ACTIVITY_DECAY_MS = 800;
export const COPY_BTN_RESET_MS = 900;
export const RECONNECT_BTN_RESET_MS = 1500;
export const RATE_WINDOW_MS = 2000;
export const SEARCH_DEBOUNCE_MS = 200;
export const STATS_INTERVAL_MS = 1000;

// Scroll tolerance: how close to the bottom still counts as "at the bottom"
// for sticky-scroll purposes. Absorbs sub-pixel rounding and the few-pixel
// gap some browsers leave after a programmatic scrollTop assignment.
export const SCROLL_AT_BOTTOM_TOLERANCE_PX = 16;
