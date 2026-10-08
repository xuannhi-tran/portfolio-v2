// Build-time markup for the cover and contact links, from src/site.js.
// Empty values are skipped, so there is never a dead link.
const escapeHtml = (s) =>
  String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const external = (url, text, label) =>
  url
    ? `<li><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(label)}">${text}</a></li>`
    : "";

const cvLink = (site, text, label) =>
  site.cv
    ? `<li><a href="${escapeHtml(site.cv)}" download="${escapeHtml(site.cvFileName)}" aria-label="${escapeHtml(label)}">${text}</a></li>`
    : "";

const wrap = (items) => items.filter(Boolean).join("\n            ");

export function renderCoverLinks(site) {
  return wrap([
    external(site.github, "GitHub", "GitHub profile (opens in a new tab)"),
    external(site.linkedin, "LinkedIn", "LinkedIn profile (opens in a new tab)"),
    cvLink(site, "CV", "Download my CV (PDF)"),
  ]);
}

export function renderContactLinks(site) {
  const email = site.email ? `<li><a href="${escapeHtml(site.email)}" aria-label="Email Nhi">Email</a></li>` : "";
  return wrap([
    email,
    external(site.linkedin, "LinkedIn", "LinkedIn profile (opens in a new tab)"),
    external(site.github, "GitHub", "GitHub profile (opens in a new tab)"),
  ]);
}

export function renderCvButton(site) {
  return site.cv
    ? `<a class="button" href="${escapeHtml(site.cv)}" download="${escapeHtml(site.cvFileName)}" aria-label="Download my CV (PDF)">Download CV</a>`
    : "";
}

// Optional photo for an About tile (public/about/tile-<n>.jpg). No file, no markup (so no 404).
export const renderTilePhoto = (n, exists) =>
  exists ? `<img class="about-photo" src="/about/tile-${n}.jpg" alt="" decoding="async">` : "";
