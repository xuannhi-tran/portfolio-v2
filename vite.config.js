import { statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { renderCovers, renderTracks } from "./scripts/sleeves.js";

const dataFile = resolve(import.meta.dirname, "src/projects.js");

const escapeHtml = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function renderCard(p) {
  const demo = p.demoUrl
    ? `\n          <a href="${escapeHtml(p.demoUrl)}" target="_blank" rel="noopener noreferrer">Live demo</a>`
    : "";
  return `        <li class="card">
          <p class="label">Side ${escapeHtml(p.side)} · ${escapeHtml(p.year)}</p>
          <h3>${escapeHtml(p.title)}</h3>
          <p>${escapeHtml(p.description)}</p>
          <p class="stack label">${escapeHtml(p.stack)}</p>
          <div class="card-links">
          <a href="${escapeHtml(p.repoUrl)}" rel="noopener">Repo</a>${demo}
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
      return html
        .replace("<!-- project-cards -->", projects.map(renderCard).join("\n"))
        .replace("<!-- project-tracks -->", renderTracks(projects))
        .replace("<!-- project-covers -->", renderCovers(projects));
    },
    handleHotUpdate({ file, server }) {
      if (resolve(file) === dataFile) {
        server.ws.send({ type: "full-reload" });
        return [];
      }
    },
  };
}

export default {
  plugins: [projectCards()],
};
