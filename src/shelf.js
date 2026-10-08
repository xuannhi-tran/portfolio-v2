// Record shelf screen: the text list (real buttons) plus the 3D scene.
// three.js and gsap are imported only when the screen opens, so the cover stays light.
// Hovering or focusing a text item, or hovering a sleeve in the scene, "activates"
// the pair; clicking marks it selected (the pull-out comes in a later stage).

const tracks = [...document.querySelectorAll(".track")];
const canvas = document.getElementById("scene");
const status = document.getElementById("shelf-status");

let active = -1;
let selected = -1;
let scene = null;
let entered = false;

function render() {
  tracks.forEach((track, i) => {
    track.classList.toggle("is-active", i === active);
    track.setAttribute("aria-pressed", String(i === selected));
  });
  if (status) {
    status.textContent = selected === -1 ? "" : `Selected: ${tracks[selected].querySelector(".track-title").textContent}`;
  }
  scene?.setActive(active);
  scene?.setSelected(selected);
}

function setActive(i) {
  active = i;
  render();
}

function toggleSelected(i) {
  selected = selected === i ? -1 : i;
  render();
}

export function initShelf() {
  tracks.forEach((track, i) => {
    track.addEventListener("pointerenter", () => setActive(i));
    track.addEventListener("focus", () => setActive(i));
    track.addEventListener("pointerleave", () => active === i && setActive(-1));
    track.addEventListener("blur", () => active === i && setActive(-1));
    track.addEventListener("click", () => toggleSelected(i));
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && selected !== -1) toggleSelected(selected);
  });
}

// No motion or no WebGL: the list view is the experience.
function fallBackToList() {
  location.replace("#/list");
}

export async function enterShelf() {
  entered = true;
  if (scene || !canvas) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return fallBackToList();

  try {
    const { createShelfScene } = await import("./scene/index.js");
    const covers = [...document.querySelectorAll(".cover-template")]
      .sort((a, b) => a.dataset.index - b.dataset.index)
      .map((template) => ({ template, ...template.dataset }));

    const created = await createShelfScene({
      canvas,
      covers,
      onHover: setActive,
      onSelect: toggleSelected,
    });

    if (!entered) {
      created.dispose(); // left the screen while it was loading
      return;
    }
    scene = created;
    render();
  } catch (err) {
    console.warn("3D shelf unavailable, showing the list instead.", err);
    fallBackToList();
  }
}

export function leaveShelf() {
  entered = false;
  scene?.dispose();
  scene = null;
}
