import gsap from "gsap";
import { TIMING, EASE } from "./tweaks.js";

// The pick-a-record sequence as one GSAP timeline that only animates the numbers
// in `p` (each 0..1); `update()` turns those numbers into positions. Because the
// timeline is just numbers, playing it backwards is the eject, swapping records is
// one timeline backwards then another forwards, and scrubbing it (window.__tl in dev
// builds) works frame by frame.
//
//   p.bob     1 -> 0   idle float settles
//   p.settle  0 -> 1   the picked sleeve settles back from its hover lift
//   p.dim     0 -> 1 -> 0   the other sleeves darken, then light up again
//   p.slide   0 -> 1   record slides out of its sleeve
//   p.arc     0 -> 1   record travels over the turntable
//   p.leave   0 -> 1   the played sleeve leaves the stack and the others close up
//   p.camera  0 -> 1   the picture shifts from the stack layout to the playing layout
//   p.lower   0 -> 1   record lowers onto the spindle (may overshoot slightly)
//   p.needle  0 -> 1   tonearm rest -> playing
//   p.spin    0 -> 1   platter speed (1 = the calm base speed)
//   p.panel   0 -> 1   the info panel fades in (so it fades out first on eject / swap)
export function createPickProgress() {
  return { bob: 1, settle: 0, dim: 0, slide: 0, arc: 0, leave: 0, camera: 0, lower: 0, needle: 0, spin: 0, panel: 0 };
}

export function createPickTimeline(p, update) {
  const tl = gsap.timeline({ paused: true, onUpdate: update });
  const step = (key, to, prop = key) =>
    tl.to(p, { [prop]: to, duration: TIMING[key].duration, ease: EASE[key] }, TIMING[key].at);

  step("bob", 0);
  step("settle", 1);
  step("dim", 1);
  step("undim", 0, "dim");
  step("slide", 1);
  step("arc", 1);
  step("leave", 1);
  step("camera", 1);
  step("lower", 1);
  step("needle", 1);
  step("spin", 1);
  step("panel", 1);
  return tl;
}
