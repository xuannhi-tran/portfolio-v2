import gsap from "gsap";
import { TIMING, TIMING_ROW, EASE } from "./tweaks.js";

// The pick-a-record sequence as one GSAP timeline that only animates the numbers
// in `p` (each 0..1); `update()` turns those numbers into positions. Because the
// timeline is just numbers, playing it backwards is the eject, and scrubbing it (window.__tl in dev
// builds) works frame by frame.
//
//   p.bob     1 -> 0   idle float settles
//   p.settle  0 -> 1   the picked sleeve settles back from its hover lift
//   p.dim     0 -> 1 -> 0   the other sleeves darken, then light up again (swap)
//   p.slide   0 -> 1   record slides out of its sleeve
//   p.arc     0 -> 1   record travels over the turntable
//   p.leave   0 -> 1   the played sleeve fades out
//   p.camera  0 -> 1   the picture shifts (swap) / cuts (pick from the row) from the row layout to the playing layout
//   p.lower   0 -> 1   record lowers onto the spindle
//   p.needle  0 -> 1   tonearm rest -> playing
//   p.spin    0 -> 1   platter speed (1 = the calm base speed)
//   p.panel   0 -> 1   the info panel fades in (so it fades out first on eject / swap)
// A pick from the row (`direct`, TIMING_ROW) also has:
//   p.out     0 -> 1   the other sleeves fade out in the row
//   p.table   0 -> 1   the turntable fades in
//   p.stack   0 -> 1   the stack on the left fades in
//   p.frame   0 -> 1   the demo frame (the showcase camera itself cuts with p.camera)
//   p.direct  1        constant (0 for a swap); p.pin is set to 1 while a swap takes such a record back to the stack
export function createPickProgress({ direct = false } = {}) {
  return {
    bob: 1, settle: 0, dim: 0, slide: 0, arc: 0, leave: 0, camera: 0, lower: 0, needle: 0, spin: 0, panel: 0,
    out: 0, table: direct ? 0 : 1, stack: direct ? 0 : 1, frame: 0, direct: direct ? 1 : 0, pin: 0,
  };
}

export function createPickTimeline(p, update, { direct = false } = {}) {
  const tl = gsap.timeline({ paused: true, onUpdate: update });
  const table = direct ? TIMING_ROW : TIMING;
  const step = (key, to, prop = key) =>
    tl.to(p, { [prop]: to, duration: table[key].duration, ease: EASE[key] ?? "none" }, table[key].at);

  step("bob", 0);
  step("settle", 1);
  step("slide", 1);
  step("arc", 1);
  step("leave", 1);
  step("camera", 1);
  step("lower", 1);
  step("needle", 1);
  step("spin", 1);
  step("panel", 1);
  if (direct) {
    step("out", 1);
    step("table", 1);
    step("stack", 1);
    step("frame", 1);
  } else {
    step("dim", 1);
    step("undim", 0, "dim");
  }
  return tl;
}
