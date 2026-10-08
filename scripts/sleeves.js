// Build-time rendering of the record shelf (used by vite.config.js):
// the text list of tracks and the stack of sleeves. Both are real <button>s.

const escapeHtml = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

// Greedy word wrap so long titles break into short lines on the cover.
function wrapTitle(title, max = 11) {
  const lines = [];
  for (const word of title.split(" ")) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + " " + word).length <= max) {
      lines[lines.length - 1] = last + " " + word;
    } else {
      lines.push(word);
    }
  }
  return lines;
}

// Simple abstract motifs, drawn in the upper right of a 200x200 cover.
const motifs = {
  document: `
    <rect x="108" y="34" width="70" height="88" rx="3" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".6" />
    <g stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity=".85">
      <line x1="118" y1="52" x2="166" y2="52" />
      <line x1="118" y1="64" x2="158" y2="64" />
      <line x1="118" y1="76" x2="166" y2="76" />
      <line x1="118" y1="88" x2="150" y2="88" />
      <line x1="118" y1="100" x2="140" y2="100" />
    </g>`,
  bars: `
    <g fill="currentColor" opacity=".85">
      <rect x="106" y="90" width="11" height="30" />
      <rect x="123" y="68" width="11" height="52" />
      <rect x="140" y="80" width="11" height="40" />
      <rect x="157" y="46" width="11" height="74" />
      <rect x="174" y="60" width="11" height="60" />
    </g>
    <line x1="102" y1="120.5" x2="190" y2="120.5" stroke="currentColor" opacity=".6" />`,
  compass: `
    <circle cx="146" cy="78" r="40" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".6" />
    <g transform="rotate(35 146 78)">
      <polygon points="146,42 154,78 138,78" fill="currentColor" opacity=".9" />
      <polygon points="146,114 154,78 138,78" fill="currentColor" opacity=".35" />
    </g>
    <circle cx="146" cy="78" r="2.5" fill="currentColor" />`,
  wave: `
    <g stroke="currentColor" stroke-width="4" stroke-linecap="round" opacity=".85">
      <line x1="106" y1="70" x2="106" y2="86" />
      <line x1="116" y1="62" x2="116" y2="94" />
      <line x1="126" y1="48" x2="126" y2="108" />
      <line x1="136" y1="60" x2="136" y2="96" />
      <line x1="146" y1="38" x2="146" y2="118" />
      <line x1="156" y1="56" x2="156" y2="100" />
      <line x1="166" y1="46" x2="166" y2="110" />
      <line x1="176" y1="66" x2="176" y2="90" />
      <line x1="186" y1="74" x2="186" y2="82" />
    </g>`,
};

function renderCover(p, i) {
  const lines = wrapTitle(p.title);
  const lineHeight = 25;
  const lastBaseline = 184;
  const tspans = lines
    .map((line, n) => {
      const y = lastBaseline - (lines.length - 1 - n) * lineHeight;
      return `<tspan x="14" y="${y}">${escapeHtml(line)}</tspan>`;
    })
    .join("");

  return `<svg class="sleeve-cover" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
            <defs>
              <filter id="grain-${i}" x="0" y="0" width="100%" height="100%">
                <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
                <feColorMatrix type="saturate" values="0" />
              </filter>
            </defs>
            <rect width="200" height="200" fill="${escapeHtml(p.cover.color)}" />
            <rect width="200" height="200" filter="url(#grain-${i})" opacity="0.14" />
            <text class="cover-label" x="14" y="24">SIDE ${escapeHtml(p.side)} · ${escapeHtml(p.year)}</text>
            ${motifs[p.cover.motif] ?? ""}
            <text class="cover-title">${tspans}</text>
          </svg>`;
}

// The cover SVGs are kept in inert <template>s. The 3D scene reads them and
// turns each one into a texture (see src/scene/covers.js).
export function renderCovers(projects) {
  return projects
    .map(
      (p, i) => `        <template class="cover-template" data-index="${i}" data-color="${escapeHtml(p.cover.color)}" data-title="${escapeHtml(p.title)}" data-side="${escapeHtml(p.side)}" data-year="${escapeHtml(p.year)}">
          ${renderCover(p, i)}
        </template>`,
    )
    .join("\n");
}
// The text list on the left, grouped under "Side A" / "Side B" labels.
export function renderTracks(projects) {
  const sides = [];
  projects.forEach((p, i) => {
    let group = sides.find((s) => s.side === p.side);
    if (!group) sides.push((group = { side: p.side, items: [] }));
    group.items.push(`            <li>
              <button type="button" class="track" data-index="${i}" data-slug="${escapeHtml(p.slug)}" aria-pressed="false">
                <span class="track-title">${escapeHtml(p.title)}</span>
                <span class="track-year label">${escapeHtml(p.year)}</span>
              </button>
            </li>`);
  });

  return sides
    .map(
      (s) => `        <div class="track-group">
          <p class="label">Side ${escapeHtml(s.side)}</p>
          <ul class="tracks">
${s.items.join("\n")}
          </ul>
        </div>`,
    )
    .join("\n");
}
// Where a project's screenshot lives, and the label for the demo frame's title bar:
// the live demo's hostname, otherwise the repo name.
export const screenshotUrl = (p) => `/demos/${p.slug}.png`;
export function demoHost(p) {
  try {
    if (p.demoUrl) return new URL(p.demoUrl).hostname;
    if (p.repoUrl) return new URL(p.repoUrl).pathname.split("/").filter(Boolean).pop() ?? "";
  } catch {
    /* fall through */
  }
  return "";
}

// The info panel for every project (shown one at a time on the right while a record plays).
// Real HTML written at build time; src/shelf.js only shows and hides it. The three notes are
// the callouts that the showcase connects to the screenshot with thin lines. On narrow screens
// there are no lines: the screenshot sits above the notes as a plain list.
export function renderPanels(projects) {
  return projects
    .map((p, i) => {
      const links = [
        p.demoUrl
          ? `<a class="button" href="${escapeHtml(p.demoUrl)}" target="_blank" rel="noopener noreferrer">Live demo</a>`
          : "",
        p.repoUrl
          ? `<a class="button" href="${escapeHtml(p.repoUrl)}" target="_blank" rel="noopener noreferrer">Repo</a>`
          : "",
      ]
        .filter(Boolean)
        .join("\n            ");
      const notes = (p.tracks ?? [])
        .map(
          (t, n) => `<li class="callout-note" tabindex="0" data-n="${n}">
              <p class="track-name label">${escapeHtml(t.name)}</p>
              <p class="track-text">${escapeHtml(t.text)}</p>
            </li>`,
        )
        .join("\n            ");
      return `      <section class="panel" data-index="${i}" data-slug="${escapeHtml(p.slug)}" data-host="${escapeHtml(demoHost(p))}" data-hotspots="${escapeHtml(JSON.stringify(p.hotspots ?? []))}" aria-labelledby="panel-title-${escapeHtml(p.slug)}" hidden>
          <p class="label panel-side">Side ${escapeHtml(p.side)} · ${escapeHtml(p.year)}</p>
          <h3 class="panel-title" id="panel-title-${escapeHtml(p.slug)}" tabindex="-1">${escapeHtml(p.title)}</h3>
          <p class="panel-desc">${escapeHtml(p.description)}</p>
          <img class="shot panel-shot" src="${screenshotUrl(p)}" alt="Screenshot of ${escapeHtml(p.title)}" loading="lazy" decoding="async">
          <ul class="callouts" aria-label="Notes">
            ${notes}
          </ul>
          <p class="stack label">${escapeHtml(p.stack)}</p>
          <div class="panel-links">
            ${links}
          </div>
        </section>`;
    })
    .join("\n");
}