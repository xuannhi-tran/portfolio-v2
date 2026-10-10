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

// The Contact section: a column per entry (label on top, the value as a large link), built from src/site.js. The value shown
// is a readable form of the url (no scheme, no mailto:); an entry with an empty url is left out, and --cols tells the grid how
// many columns are left.
const readable = (url) => String(url).replace(/^mailto:/i, "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");

function contactItem(label, url, { external: opens, name }) {
  if (!url) return "";
  const text = readable(url);
  const attrs = opens ? ` target="_blank" rel="noopener noreferrer"` : "";
  const aria = `${name}: ${text}${opens ? " (opens in a new tab)" : ""}`;
  return `<li class="contact-item"><span class="label">${label}</span><a class="contact-link" href="${escapeHtml(url)}"${attrs} aria-label="${escapeHtml(aria)}">${escapeHtml(text)}<span class="contact-arrow" aria-hidden="true">&nearr;</span></a></li>`;
}

export function renderContactLinks(site) {
  const items = [
    contactItem("Email", site.email, { external: false, name: "Email Nhi" }),
    contactItem("LinkedIn", site.linkedin, { external: true, name: "LinkedIn profile" }),
    contactItem("GitHub", site.github, { external: true, name: "GitHub profile" }),
  ].filter(Boolean);
  return items.length
    ? `<ul class="contact-grid" style="--cols: ${items.length}">
          ${items.join("\n          ")}
        </ul>`
    : "";
}

export function renderCvButton(site) {
  return site.cv
    ? `<div class="contact-cv"><a class="button" href="${escapeHtml(site.cv)}" download="${escapeHtml(site.cvFileName)}" aria-label="Download my CV (PDF)">Download CV<span class="cv-arrow" aria-hidden="true">&darr;</span></a></div>`
    : "";
}

// Optional photo for an About tile (public/about/tile-<n>.jpg). No file, no markup (so no 404).
export const renderTilePhoto = (n, exists) =>
  exists ? `<img class="about-photo" src="/about/tile-${n}.jpg" alt="" decoding="async">` : "";

// The first screen, from src/site.js: the pill above the name, the tagline, and the strip at the bottom (an empty value is left out)
export const renderHeroBadge = (site) =>
  site.heroStatus
    ? `<p class="hero-badge"><span class="hero-badge-dot" aria-hidden="true"></span>${escapeHtml(site.heroStatus)}</p>`
    : "";

export const renderHeroLine = (site) => (site.heroTagline ? `<p class="hero-line">${escapeHtml(site.heroTagline)}</p>` : "");

export function renderHeroFoot(site) {
  const item = (label, value) => (value ? `<li class="hero-foot-item"><span class="label">${label}</span>${value}</li>` : "");
  const email = site.email
    ? `<a class="hero-foot-link" href="${escapeHtml(site.email)}" aria-label="Email Nhi: ${escapeHtml(readable(site.email))}">${escapeHtml(readable(site.email))}<span class="hero-foot-arrow" aria-hidden="true">&nearr;</span></a>`
    : "";
  const items = [
    item("Location", site.heroLocation ? `<span class="hero-foot-value">${escapeHtml(site.heroLocation)}</span>` : ""),
    // each name is kept whole (nowrap): the line only breaks between items
    item("Built with", site.heroStack ? `<span class="hero-foot-value">${site.heroStack.split("·").map((t) => `<span class="nb">${escapeHtml(t.trim())}</span>`).join(" · ")}</span>` : ""),
    item("Get in touch", email ? `<span class="hero-foot-value">${email}</span>` : ""),
  ].filter(Boolean);
  return items.length ? `<ul class="hero-foot" style="--cols: ${items.length}">${items.join("")}</ul>` : "";
}
