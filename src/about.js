// The About sleeve: the record slides out from behind it when it scrolls into view, then spins slowly
// (paused while the section is off screen). Hovering the sleeve nudges the record out a little further.
// Reduced motion: nothing moves, the record stays in its final position (the CSS default).
// Sizes and timings are in the ABOUT block of src/scene/tweaks.js.
import { ABOUT } from "./scene/tweaks.js";

const narrowQuery = matchMedia("(max-width: 899.98px)");
const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");

export function initAbout() {
  const root = document.documentElement.style;
  root.setProperty("--about-peek", String(ABOUT.peek));
  root.setProperty("--about-peek-narrow", String(ABOUT.peekNarrow));
  const stage = document.querySelector("[data-about-stage]");
  const sleeve = stage?.querySelector("[data-about-sleeve]");
  const record = stage?.querySelector("[data-about-record]");
  const disc = stage?.querySelector("[data-about-disc]");
  if (!sleeve || !record || !disc || reducedQuery.matches) return;

  let gsap = null;
  let entered = false;
  let entering = false;
  let visible = false;
  let spin = null;

  stage.classList.add("is-armed"); // the record starts hidden behind the sleeve (CSS), until it is time

  // Wide screens: the record moves sideways. Narrow: it peeks out of the bottom and moves vertically.
  const axis = () => (narrowQuery.matches ? "y" : "x");
  const hiddenOffset = () => -record.offsetWidth * (narrowQuery.matches ? ABOUT.peekNarrow : ABOUT.peek) - 4;

  async function enter() {
    gsap = (await import("gsap")).default;
    entering = true;
    gsap.fromTo(
      record,
      { [axis()]: hiddenOffset() },
      {
        [axis()]: 0,
        duration: ABOUT.slideDuration,
        ease: ABOUT.slideEase,
        onComplete: () => {
          entering = false;
          spin = gsap.to(disc, { rotation: 360, duration: ABOUT.spinSeconds, ease: "none", repeat: -1, paused: !visible });
        },
      },
    );
    stage.classList.remove("is-armed"); // the tween's inline transform takes over
  }

  new IntersectionObserver(
    (entries) => {
      visible = entries.some((e) => e.isIntersecting);
      if (visible && !entered) {
        entered = true;
        enter();
      }
      spin?.paused(!visible);
    },
    { threshold: ABOUT.enterThreshold },
  ).observe(stage);

  // Hover (wide screens only)
  sleeve.addEventListener("pointerenter", () => {
    if (!gsap || entering || narrowQuery.matches) return;
    gsap.to(record, { x: ABOUT.hoverShift, duration: ABOUT.hoverDuration, ease: "power2.out", overwrite: "auto" });
  });
  sleeve.addEventListener("pointerleave", () => {
    if (!gsap || entering || narrowQuery.matches) return;
    gsap.to(record, { x: 0, duration: ABOUT.hoverBackDuration, ease: "power3.out", overwrite: "auto" });
  });

  // Crossing the breakpoint changes the direction it peeks: forget any offset from the other layout
  narrowQuery.addEventListener("change", () => gsap?.set(record, { x: 0, y: 0 }));
}
