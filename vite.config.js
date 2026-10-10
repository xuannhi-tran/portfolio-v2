import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { renderTilePhoto, renderContactLinks, renderCoverLinks, renderCvButton, renderHeroBadge, renderHeroFoot, renderHeroLine } from "./scripts/site-links.js";
import { renderCovers, renderPanels, renderTracks, screenshotSize, screenshotUrl } from "./scripts/sleeves.js";

const dataFile = resolve(import.meta.dirname, "src/projects.js");
const siteFile = resolve(import.meta.dirname, "src/site.js");

const escapeHtml = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function renderCardTracks(p) {
  if (!p.tracks?.length) return "";
  // the same numbered tracklist as the record panel (same classes, same look)
  const items = p.tracks
    .map(
      (t, n) => `<li class="panel-track">
                <p class="track-name label">${String(n + 1).padStart(2, "0")} ${escapeHtml(t.name)}</p>
                <p class="track-text">${escapeHtml(t.text)}</p>
              </li>`,
    )
    .join("");
  return `<ol class="panel-tracks row-tracks" aria-label="Notes on ${escapeHtml(p.title)}">${items}</ol>`;
}

// The list mode of the Projects section: one row per project, like a tracklist. The header is a link that opens the record
// (same route as the 3D row); the description, links and the notes stay under it.
function renderCard(p, i) {
  const demo = p.demoUrl
    ? `
            <a href="${escapeHtml(p.demoUrl)}" target="_blank" rel="noopener noreferrer">Live demo</a>`
    : "";
  // The project's demo image as a thumbnail (the whole picture, never cropped); it opens the live demo, else the repo. No file: no thumbnail.
  const size = screenshotSize(p);
  const target = p.demoUrl ? { url: p.demoUrl, label: `Open ${p.title} live demo` } : p.repoUrl ? { url: p.repoUrl, label: `Open ${p.title} repository` } : null;
  const img = `<img class="row-thumb-img" src="${screenshotUrl(p)}"${size} alt="Screenshot of ${escapeHtml(p.title)}" loading="lazy" decoding="async">`;
  const thumb = !size
    ? ""
    : target
      ? `<a class="row-thumb" href="${escapeHtml(target.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(target.label)} (opens in a new tab)">${img}</a>`
      : `<span class="row-thumb">${img}</span>`;
  const tracks = renderCardTracks(p);
  const notes = tracks
    ? `
            <details class="row-more">
              <summary class="more-btn"><span class="more-closed">More information</span><span class="more-open">Hide information</span><svg class="more-icon" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"><path d="M1.5 6h9"/><path class="more-v" d="M6 1.5v9"/></svg></summary>
              ${tracks}
            </details>`
    : "";
  return `        <li class="row">
          <a class="row-head" href="#/projects/${escapeHtml(p.slug)}">
            <span class="row-num label">${String(i + 1).padStart(2, "0")}</span>
            <span class="row-title">${escapeHtml(p.title)}</span>
            <span class="row-leader" aria-hidden="true"></span>
            <span class="row-meta label"><span class="row-stack">${escapeHtml(p.stack)}</span><span class="row-year">${escapeHtml(p.year)}</span></span>
            <span class="row-arrow" aria-hidden="true">&rarr;</span>
          </a>
          <div class="row-body${thumb ? "" : " no-thumb"}">
            <p class="label row-side">Side ${escapeHtml(p.side)}</p>
            <p class="row-desc">${escapeHtml(p.description)}</p>
            ${thumb}
            <div class="row-links">
            <a href="${escapeHtml(p.repoUrl)}" rel="noopener">Repo</a>${demo}
            </div>${notes}
          </div>
        </li>`;
}

// Renders the project cards into index.html at dev/build time, so the
// output is real HTML (no client-side rendering needed).
function projectCards() {
  return {
    name: "project-cards",
    async transformIndexHtml(html) {
      // The mtime query busts Node's import cache so edits show up on reload.
      const url = `${pathToFileURL(dataFile).href}?t=${statSync(dataFile).mtimeMs}`;
      const { projects } = await import(url);
      const { site } = await import(`${pathToFileURL(siteFile).href}?t=${statSync(siteFile).mtimeMs}`);
      return html
        .replace("<!-- site-links-cover -->", renderCoverLinks(site))
        .replace("<!-- site-hero-badge -->", renderHeroBadge(site))
        .replace("<!-- site-hero-line -->", renderHeroLine(site))
        .replace("<!-- site-hero-foot -->", renderHeroFoot(site))
        .replace("<!-- site-links-contact -->", renderContactLinks(site))
        .replace(/<!-- about-photo-(\d) -->/g, (_, n) =>
          renderTilePhoto(n, existsSync(resolve(import.meta.dirname, `public/about/tile-${n}.jpg`))),
        )
        .replace("<!-- site-cv-button -->", renderCvButton(site))
        .replace("<!-- project-cards -->", projects.map(renderCard).join("\n"))
        .replace("<!-- project-tracks -->", renderTracks(projects))
        .replace("<!-- project-covers -->", renderCovers(projects))
        .replace("<!-- project-panels -->", renderPanels(projects));
    },
    handleHotUpdate({ file, server }) {
      if ([dataFile, siteFile].includes(resolve(file))) {
        server.ws.send({ type: "full-reload" });
        return [];
      }
    },
  };
}

export default {
  plugins: [projectCards()],
};
