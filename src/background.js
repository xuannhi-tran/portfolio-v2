// The page background (see the --bg-* variables in src/style.css): the groove rings move slowly with the scroll
// (--bg-parallax x the page's speed). The layer is fixed; one translate3d is written per frame, nothing else changes,
// and nothing is animated on its own. No parallax with reduced motion, and none on narrow screens.
const rings = document.querySelector("[data-bg-rings]");

export function initBackground() {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("nobg")) {
    document.documentElement.classList.add("no-bg"); // dev: compare frame times with and without the background
  }
  if (!rings) return;

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const narrow = matchMedia("(max-width: 47.99rem)");
  const shelf = document.getElementById("shelf");
  let factor = 0;
  let tick = 0;
  let shelfTop = 0; // page coordinates of the Projects section
  let shelfHeight = 0;
  let lastOpacity = "";

  const measure = () => {
    if (!shelf) return;
    const rect = shelf.getBoundingClientRect();
    shelfTop = rect.top + window.scrollY;
    shelfHeight = rect.height;
  };
  // The rings are for the hero, About and Contact. While the Projects section fills the screen (or a record is open there)
  // they are gone, so the dense middle never sits behind the Records / List toggle or the record panel.
  const apply = () => {
    tick = 0;
    rings.style.transform = `translate3d(0, ${(-window.scrollY * factor).toFixed(1)}px, 0)`;
    const vh = window.innerHeight;
    const shown = Math.max(0, Math.min(shelfTop + shelfHeight, window.scrollY + vh) - Math.max(shelfTop, window.scrollY)) / vh;
    const opacity = String(Math.max(0, 1 - shown * 1.6).toFixed(2));
    if (opacity !== lastOpacity) {
      rings.style.opacity = opacity;
      lastOpacity = opacity;
    }
  };
  const onScroll = () => {
    if (!tick) tick = requestAnimationFrame(apply);
  };
  const setUp = () => {
    factor = reduced.matches || narrow.matches ? 0 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bg-parallax")) || 0;
    rings.style.transform = "";
    apply();
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  if (shelf) new ResizeObserver(() => { measure(); apply(); }).observe(shelf);
  measure();
  setUp();
  reduced.addEventListener("change", setUp);
  narrow.addEventListener("change", setUp);
}
