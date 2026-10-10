// The browsing row's geometry (the sleeves in one row, or the 2 x 2 grid on narrow screens), in px, from the window's size alone.
// Shared by the scene (which places the sleeves) and src/shelf.js (which sizes the Projects section before the scene exists, so
// the page does not change height under a nav scroll when the 3D code arrives).
import { ROW } from "./tweaks.js";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;

export function rowMetrics({ viewW, viewH, n, grid, capSpace }) {
  const cols = grid ? Math.min(2, n) : n;
  const rows = Math.ceil(n / cols);
  // Tablet widths: the sleeves sit closer together and fill more of the width, so they do not look small (ROW.tablet)
  const tw = clamp((viewW - ROW.tablet.from) / (ROW.tablet.to - ROW.tablet.from), 0, 1);
  const step = grid ? ROW.stepCompact : lerp(ROW.tablet.stepX, ROW.stepX, tw);
  const fillWidth = grid ? ROW.fillWidth : lerp(ROW.tablet.fillWidth, ROW.fillWidth, tw);
  // Each sleeve has a caption under it (capSpace px): it comes out of the height the row may take, and in the 2 x 2 grid it
  // pushes the second row down by the same amount
  const worldW = (cols - 1) * step + 2;
  const px = Math.min((viewW * fillWidth) / worldW, (viewH * ROW.fillHeight - rows * capSpace) / ((rows - 1) * step + 2), ROW.maxSleevePx / 2);
  const stepY = rows > 1 ? step + capSpace / px : step;
  const worldH = (rows - 1) * stepY + 2;
  // The row hangs a fixed distance below the label line (it is not centred in the section, so a tall screen leaves no gap)
  const gap = grid ? ROW.gapBelowHeading : Math.max(32, Math.min(ROW.gapBelowHeading, viewW * 0.05));
  return { cols, rows, step, px, stepY, worldH, gap };
}

// How tall the crate's column has to be while the row is shown (--row-h): down to the captions under the last sleeve, plus air.
// headBottom and crateTop are in the same coordinates (viewport px).
export const rowHeight = (m, { headBottom, crateTop, capSpace }) =>
  Math.max(0, Math.round(headBottom + m.gap + m.worldH * m.px + capSpace + ROW.bottomAir - crateTop));
