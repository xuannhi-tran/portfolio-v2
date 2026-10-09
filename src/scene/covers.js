import * as THREE from "three";
import { sideColor } from "./sleeve.js";
import { SLEEVE_BORDER } from "./tweaks.js";

const INK = "#ece6d6";

// Turns one of the cover SVGs (kept in a <template>, see scripts/sleeves.js)
// into a canvas texture.
//
// SVG images can't use the page's web fonts, so the shapes, grain and colour
// are rasterised from the SVG without its <text>, and the label and title
// are then drawn on top with the real fonts, at the positions the SVG gives.
export async function renderCoverTexture(template, { size = 1024, anisotropy = 1 } = {}) {
  const svg = template.content.firstElementChild.cloneNode(true);

  const label = svg.querySelector(".cover-label");
  const labelText = label && { x: +label.getAttribute("x"), y: +label.getAttribute("y"), text: label.textContent };
  const titleLines = [...svg.querySelectorAll(".cover-title tspan")].map((t) => ({
    x: +t.getAttribute("x"),
    y: +t.getAttribute("y"),
    text: t.textContent,
  }));
  svg.querySelectorAll("text").forEach((t) => t.remove());

  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  const ink = template.dataset.ink || INK;
  svg.style.color = ink; // motifs use currentColor

  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }),
  );
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } finally {
    URL.revokeObjectURL(url);
  }

  // Make sure the fonts are loaded before drawing text with them.
  await Promise.all([
    document.fonts.load('24px "EB Garamond"'),
    document.fonts.load('7px "IBM Plex Mono"'),
  ]).catch(() => {});

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const k = size / 200; // SVG viewBox is 200 x 200
  ctx.drawImage(img, 0, 0, size, size);

  ctx.fillStyle = ink;
  ctx.textBaseline = "alphabetic";

  if (labelText) {
    ctx.globalAlpha = 0.75;
    ctx.font = `${7 * k}px "IBM Plex Mono", monospace`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${0.14 * 7 * k}px`;
    ctx.fillText(labelText.text, labelText.x * k, labelText.y * k);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    ctx.globalAlpha = 1;
  }

  ctx.font = `${24 * k}px "EB Garamond", Georgia, serif`;
  for (const line of titleLines) ctx.fillText(line.text, line.x * k, line.y * k);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}

// The small label on a sleeve's front edge: title on the left, side and year on
// the right, in the mono font. `cover` is { title, side, year, color }.
export async function renderEdgeTexture(cover, { size = 1024, anisotropy = 1 } = {}) {
  await document.fonts.load('40px "IBM Plex Mono"').catch(() => {});

  const width = size;
  const height = size / 8; // the front edge is 2 x 0.24 units, roughly 8:1
  const k = size / 1024; // sizes below are written for a 1024-wide texture
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = `#${sideColor(cover.color).getHexString()}`;
  ctx.fillRect(0, 0, width, height);
  if (cover.border) {
    ctx.strokeStyle = SLEEVE_BORDER;
    ctx.lineWidth = Math.max(1, 4 * (size / 1024));
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, width - ctx.lineWidth, height - ctx.lineWidth);
  }

  ctx.fillStyle = cover.ink || INK;
  ctx.textBaseline = "middle";
  ctx.font = `500 ${38 * k}px "IBM Plex Mono", monospace`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${2 * k}px`;

  ctx.textAlign = "left";
  ctx.fillText(cover.title.toUpperCase(), 32 * k, height / 2 + 3 * k);
  ctx.globalAlpha = 0.75;
  ctx.textAlign = "right";
  ctx.fillText(`SIDE ${cover.side} · ${cover.year}`, width - 32 * k, height / 2 + 3 * k);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}
