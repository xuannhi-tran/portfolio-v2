// The landing hero: a short entrance (text fades up, the record slides in) the first time it is on screen,
// and the slow spin (CSS) is paused whenever the landing is not visible. With reduced motion nothing moves.
// Sizes and timings are in the HERO block of src/scene/tweaks.js.
import { HERO } from "./scene/tweaks.js";

const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");

export function initHero() {
  const cover = document.getElementById("cover");
  const record = cover?.querySelector("[data-hero-record]");
  const copy = cover?.querySelector("[data-hero-copy]");
  if (!cover || !record || !copy) return;

  const root = cover.style;
  root.setProperty("--hero-spin", `${HERO.spinSeconds}s`);
  root.setProperty("--hero-crop", String(HERO.crop));
  // Wide screens use the tweak; narrow screens keep the size from the stylesheet
  if (matchMedia("(min-width: 900px)").matches) root.setProperty("--hero-d", HERO.diameter);
  matchMedia("(min-width: 900px)").addEventListener("change", (e) => {
    if (e.matches) root.setProperty("--hero-d", HERO.diameter);
    else root.removeProperty("--hero-d");
  });

  const animate = !reducedQuery.matches;
  let played = false;
  if (animate) cover.classList.add("is-armed");

  async function enter() {
    played = true;
    try {
      const gsap = (await import("gsap")).default;
      const items = [...copy.children];
      gsap.fromTo(
        items,
        { opacity: 0, y: HERO.riseBy },
        { opacity: 1, y: 0, duration: HERO.enterDuration, stagger: HERO.stagger, ease: "power2.out", clearProps: "transform,opacity" },
      );
      gsap.fromTo(
        record,
        { opacity: 0, x: HERO.recordShift },
        { opacity: 1, x: 0, duration: HERO.recordDuration, ease: "power3.out", clearProps: "transform,opacity" },
      );
      cover.classList.remove("is-armed"); // the tweens' inline values take over
    } catch {
      cover.classList.remove("is-armed"); // no gsap: just show everything
    }
  }

  new IntersectionObserver((entries) => {
    const visible = entries.some((e) => e.isIntersecting);
    cover.classList.toggle("is-offscreen", !visible);
    if (visible && animate && !played) enter();
  }).observe(cover);
}
