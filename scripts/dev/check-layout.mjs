// Dev-only layout check (not part of the build): drives headless Edge over the DevTools protocol against a running dev
// server and asserts the things that an overflow / clipping / animation change can silently break.
//
//   Day to day:   CHECK=<group> node scripts/dev/check-layout.mjs http://localhost:5173 --quick
//   Before a commit (all sizes, all groups):   node scripts/dev/check-layout.mjs http://localhost:5173
//
//   npm run dev                      (in another terminal)
//   --list                           the check groups, and exit
//   CHECK=hero,swap                  only those groups (default: all). Each check belongs to exactly one group.
//   --quick                          two sizes only (1366x768, 390x844), no screenshots, 8 s per step instead of 20 s
//   ONLY=960x1440,1440               just those sizes (WxH, or a width for every height); overrides --quick's sizes
//   --shots                          save screenshots (JPEG, at most 36, into .tmp/check-shots, emptied at the start)
//   --verbose                        print every passing check too (default: failures and a line per group)
//   EDGE=<path>                      the browser. CHECK_TIMEOUT=<ms> the whole-run limit (default 25 min).
//
// Exit code 1 if anything fails. A size is skipped when none of the selected groups applies to it (the click-the-stack and live-frame
// groups need the side-by-side layout). One page per size is reused for all of its groups: a group that needs a clean page reloads it,
// the others bring the page to the state they need (the row of sleeves, or a record open) without a reload.
//
// Lean on purpose (an earlier version filled a disk): ONE browser for the whole run with ONE profile folder inside the project
// (.tmp/check-profile, deleted at the end), one throwaway browser context (and tab) per size, closed when the size is done; the browser
// is always closed (finally, Ctrl+C, SIGTERM, a global timeout), every step has a timeout.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ---- groups --------------------------------------------------------------------------------------------------
const GROUPS = {
  hero: "the first screen: availability pill, the strip at the bottom, no sideways scroll",
  "projects-layout": "the Projects section in records mode: heading, label, toggle, the row of four sleeves, hover on each",
  "list-mode": 'the list mode: toggle, rows, thumbnails, the "More information" notes',
  "open-record": "every record opened: the record and the stack inside the canvas clip, screenshot shape, panel, frame, heading hidden",
  player: 'the mini player: layout, 44 px buttons, pause / play, next / previous, the "All records" pill',
  live: "the live-demo frame: clicks and focus inside it never move the page, the lock never traps the visitor (side by side)",
  touch: "switching records by clicking (mouse) and tapping (touch) the stack on the left (side by side)",
  swap: "switching records with one open: the turntable stays put, the player is hidden while records move, the timing",
  back: '"All records": after a plain open and after a swap the turntable stays put and never slides to the middle; the row returns',
  titles: "the section titles start at the rule's left edge (below 1100 px)",
  about: "the About section: title, cards hold their text, the drawing",
  contact: "the Contact section: title, columns, one line per link",
  errors: "no page errors (always runs with the other groups)",
};
const ORDER = Object.keys(GROUPS);

const args = process.argv.slice(2);
if (args.includes("--list")) {
  console.log("check groups (CHECK=<name>[,<name>]):");
  for (const [name, text] of Object.entries(GROUPS)) console.log(`  ${name.padEnd(16)} ${text}`);
  process.exit(0);
}
const base = args.find((a) => /^https?:/.test(a)) ?? "http://localhost:5173";
const quick = args.includes("--quick");
const wantShots = args.includes("--shots");
const verbose = args.includes("--verbose");
const chosen = process.env.CHECK ? process.env.CHECK.split(",").map((s) => s.trim()).filter(Boolean) : ORDER;
for (const name of chosen) {
  if (!GROUPS[name]) {
    console.log(`unknown group "${name}" (see --list)`);
    process.exit(2);
  }
}
const selected = new Set(chosen);
selected.add("errors");
const on = (name) => selected.has(name);

const root = resolve(import.meta.dirname, "../..");
const profileDir = join(root, ".tmp", "check-profile");
const shotsDir = join(root, ".tmp", "check-shots");
const MAX_SHOTS = 36;
const STEP_TIMEOUT = quick ? 8000 : 20000; // ms: one browser command or one evaluation
const GLOBAL_TIMEOUT = Number(process.env.CHECK_TIMEOUT ?? 25 * 60 * 1000); // ms: the whole run
const edge = process.env.EDGE ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const ALL_SIZES = [
  [768, 1024],
  [820, 1180],
  [960, 1440],
  [1024, 1366],
  [1024, 768],
  [1180, 820],
  [1366, 768],
  [1440, 900],
  [1920, 1080],
  [1280, 800],
  [1188, 855],
  [1100, 800],
  [1280, 720],
  [1600, 900],
  [440, 900],
  [360, 740],
  [390, 844],
];
const QUICK_SIZES = [
  [1366, 768],
  [390, 844],
];
const only = process.env.ONLY?.split(",");
const sizes = (only ? ALL_SIZES : quick ? QUICK_SIZES : ALL_SIZES).filter((s) => !only || only.some((o) => o === `${s[0]}x${s[1]}` || o === String(s[0])));
const isStacked = (w, h) => w <= 768 || w / h <= 1; // COMPACT.query: (max-width: 48rem), (max-aspect-ratio: 1/1)
const applies = (name, w, h) => (name === "touch" || name === "live" ? !isStacked(w, h) : name === "titles" ? w < 1100 : true);

// ---- bookkeeping ---------------------------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
let failed = 0;
let shotCount = 0;
let currentSize = "";
let currentGroup = "";
let mark = Date.now();
const groupMs = {}; // total ms per group, over all sizes
const failures = [];
function setGroup(name) {
  const now = Date.now();
  if (currentGroup) groupMs[currentGroup] = (groupMs[currentGroup] ?? 0) + (now - mark);
  mark = now;
  currentGroup = name;
}
const check = (label, ok, detail = "") => {
  if (ok) passed++;
  else {
    failed++;
    failures.push(`FAIL  [${currentSize}] [${currentGroup}] ${label}${detail ? "  " + detail : ""}`);
  }
  if (!ok || verbose) console.log(`${ok ? "PASS" : "FAIL"}  [${currentSize}] [${currentGroup}] ${label}${detail ? "  " + detail : ""}`);
};
const withTimeout = (promise, ms, what) => Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout (${ms} ms): ${what}`)), ms))]);
const dirSize = (dir) => {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true }).reduce((sum, e) => sum + (e.isDirectory() ? dirSize(join(dir, e.name)) : statSync(join(dir, e.name)).size), 0);
};
const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

// ---- the one browser -----------------------------------------------------------------------------------------
let proc = null;
function killBrowser() {
  try {
    if (proc?.pid && process.platform === "win32") spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" }); // (the browser's helper processes too)
    else proc?.kill();
  } catch {}
}
function cleanup() {
  killBrowser();
  proc = null;
  try {
    rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); // (Windows keeps files locked for a moment after the browser exits)
  } catch {}
}
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    cleanup();
    process.exit(130);
  });
}
const globalTimer = setTimeout(() => {
  console.log(`FAIL  the run took longer than ${GLOBAL_TIMEOUT / 60000} min: stopped`);
  cleanup();
  process.exit(1);
}, GLOBAL_TIMEOUT);

async function startBrowser() {
  rmSync(profileDir, { recursive: true, force: true });
  mkdirSync(profileDir, { recursive: true });
  const port = 9400 + Math.floor(Math.random() * 400);
  proc = spawn(
    edge,
    ["--headless=new", `--remote-debugging-port=${port}`, "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--hide-scrollbars", `--user-data-dir=${profileDir}`, "--no-first-run", "--disk-cache-size=1", "--media-cache-size=1", "about:blank"],
    { stdio: "ignore" },
  );
  let version;
  for (let i = 0; i < 60; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      break;
    } catch {}
    await sleep(250);
  }
  if (!version) throw new Error("the browser did not start");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await withTimeout(new Promise((r) => (ws.onopen = r)), STEP_TIMEOUT, "browser connection");
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) pending.get(d.id)(d), pending.delete(d.id);
  };
  const send = (method, params = {}) => withTimeout(new Promise((r) => (pending.set(++id, r), ws.send(JSON.stringify({ id, method, params })))), STEP_TIMEOUT, method);
  return { port, send, close: () => ws.close() };
}

// A fresh browser context with one tab for a size; closed again when the size is done
async function openPage(browser) {
  const { result: ctx } = await browser.send("Target.createBrowserContext");
  const { result: tgt } = await browser.send("Target.createTarget", { url: "about:blank", browserContextId: ctx.browserContextId });
  const ws = new WebSocket(`ws://127.0.0.1:${browser.port}/devtools/page/${tgt.targetId}`);
  await withTimeout(new Promise((r) => (ws.onopen = r)), STEP_TIMEOUT, "page connection");
  return {
    ws,
    close: async () => {
      try {
        ws.close();
        await browser.send("Target.disposeBrowserContext", { browserContextId: ctx.browserContextId });
      } catch {}
    },
  };
}

async function run(browser, [w, h]) {
  currentSize = `${w}x${h}`;
  const page = await openPage(browser);
  try {
    await runSize(page.ws, w, h);
  } catch (err) {
    setGroup("errors");
    check("the size ran to the end", false, String(err.message ?? err));
  } finally {
    setGroup("");
    await page.close();
  }
}

// ---- one size: one page, the groups in turn --------------------------------------------------------------------
async function runSize(ws, w, h) {
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) pending.get(d.id)(d), pending.delete(d.id);
    if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
    if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push("console.error: " + d.params.args.map((a) => a.value ?? a.description).join(" "));
  };
  const send = (method, params = {}) => withTimeout(new Promise((r) => (pending.set(++id, r), ws.send(JSON.stringify({ id, method, params })))), STEP_TIMEOUT, method);
  const val = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const shot = async (name) => {
    if (!wantShots || shotCount >= MAX_SHOTS) return;
    shotCount++;
    const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 60 });
    writeFileSync(join(shotsDir, `${name}-${w}x${h}.jpg`), Buffer.from(r.result.data, "base64"));
  };
  const rect = `(sel)=>{const e=document.querySelector(sel);if(!e)return null;const r=e.getBoundingClientRect();const cs=getComputedStyle(e);return {l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width,h:r.height,vis:cs.visibility,disp:cs.display}}`;
  const R = (sel) => val(`(${rect})(${JSON.stringify(sel)})`);
  const onScreenX = (r) => r && r.w > 0 && r.h > 0 && r.l >= -0.5 && r.r <= w + 0.5;
  const stacked = isStacked(w, h);
  const noHScroll = async (label) => {
    const sw = await val("document.documentElement.scrollWidth");
    const iw = await val("innerWidth");
    check(`no horizontal scroll (${label})`, sw <= iw, `scrollWidth ${sw} / innerWidth ${iw}`);
  };
  const mouse = async (type, x, y) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 });
  const clickAt = async (x, y) => {
    await mouse("mouseMoved", x, y);
    await mouse("mousePressed", x, y);
    await mouse("mouseReleased", x, y);
  };
  const tapAt = async (x, y) => {
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await sleep(60);
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  // wait for a condition (polled), up to `max` ms; resolves to whether it came true
  const until = async (expression, max = 9000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < max) {
      if (await val(expression)) return true;
      await sleep(100);
    }
    return false;
  };
  // wait for the page to stop scrolling (a smooth scroll from a nav click or a pick)
  const settle = async (max = 6000) => {
    const t0 = Date.now();
    let last = -1;
    let same = 0;
    while (Date.now() - t0 < max) {
      const y = await val("scrollY");
      same = y === last ? same + 1 : 0;
      if (same >= 3 && Date.now() - t0 > 500) return;
      last = y;
      await sleep(150);
    }
  };
  const STATE = "document.getElementById('shelf').dataset.state";
  const slugs = async () => val("[...document.querySelectorAll('.track')].map((t)=>t.dataset.slug)");

  // ---- the page: one load, reloaded only when a group needs it clean ----
  let dirty = false;
  const load = async (fresh) => {
    await send("Page.navigate", { url: `${base}/${fresh ? `?r=${Date.now()}` : ""}#/` });
    await until("document.fonts.status === 'loaded' && !!document.querySelector('.hero-foot-item')", 15000);
    await sleep(1500);
    dirty = false;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await load(false);

  // the row of sleeves in view and still: a record that is open is closed first, the list mode left
  const row = async () => {
    dirty = true;
    if ((await val(STATE)) !== "stack") {
      await val("document.getElementById('eject').click()");
      await until(`${STATE} === 'stack'`, 12000);
      await sleep(500);
    }
    if ((await val("document.getElementById('shelf').dataset.mode")) === "list") {
      await val("document.querySelector('[data-mode=records]').click()");
      await sleep(1500);
    }
    await val("document.querySelector('[data-nav=projects]').click()");
    await settle();
    await until("document.querySelectorAll('.sleeve-cap.is-on').length === 4", 9000);
    await sleep(300);
  };
  // record i playing (the page scrolled to it, the frame in place); a plain open from the row, or a swap if another one is open
  const open = async (i) => {
    dirty = true;
    const slug = (await slugs())[i];
    if ((await val(STATE)) === "playing" && (await val("location.hash")) === `#/projects/${slug}`) return;
    if ((await val(STATE)) === "playing") {
      await val(`document.querySelectorAll('.track')[${i}].click()`);
    } else {
      await row();
      await val(`document.querySelectorAll('.track')[${i}].click()`);
    }
    await until(`${STATE} === 'playing' && location.hash === '#/projects/${slug}'`, 12000);
    await settle(4000);
    if (!stacked) await until("(()=>{const f=document.getElementById('demo-frame');return !f.hidden && +getComputedStyle(f).opacity > 0.95})()", 6000);
    await sleep(600);
  };

  // ======================= hero =======================
  if (on("hero")) {
    setGroup("hero");
    if (dirty) await load(true);
    await noHScroll("home");
    // the availability pill sits under the header and above the name; the strip's columns are inside the hero and clear of each other and
    // of the CTA row; on desktop-size windows the whole strip is in the first screen
    const hero = await val(`(()=>{const q=(s)=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width,h:r.height}};return {nav:q('.nav'),badge:q('.hero-badge'),badgeVis:getComputedStyle(document.querySelector('.hero-badge')).visibility,name:q('#name'),cover:q('#cover'),cta:q('.hero-cta'),foot:q('.hero-foot'),items:[...document.querySelectorAll('.hero-foot-item')].map((e)=>{const r=e.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom}}),line:q('.hero-line')}})()`);
    check("hero: availability pill visible, below the header and above the name", hero.badge && hero.badge.w > 0 && hero.badgeVis === "visible" && hero.badge.t >= hero.nav.b - 0.5 && hero.badge.b <= hero.name.t + 0.5, `badge ${hero.badge?.t | 0}-${hero.badge?.b | 0}, header bottom ${hero.nav.b | 0}, name top ${hero.name.t | 0}`);
    const ov = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
    const colsOk = hero.items.length === 3 && hero.items.every((c, i) => c.l >= hero.cover.l - 0.5 && c.r <= hero.cover.r + 0.5 && c.t >= hero.cover.t - 0.5 && c.b <= hero.cover.b + 0.5 && !ov(c, hero.cta) && hero.items.every((d, j) => i === j || !ov(c, d)));
    check("hero: the three strip items are inside the hero and clear of each other and of the buttons", colsOk, JSON.stringify(hero.items.map((c) => [c.l | 0, c.t | 0, c.r | 0, c.b | 0])));
    check("hero: strip clear of the CTA row (below it)", hero.foot.t >= hero.cta.b - 0.5, `strip top ${hero.foot.t | 0}, buttons bottom ${hero.cta.b | 0}`);
    if (w >= 1280 && h <= 1100) check("hero: the whole strip is in the first screen", hero.foot.b <= h + 0.5 && hero.cover.b <= h + 1, `strip bottom ${hero.foot.b | 0}, hero bottom ${hero.cover.b | 0}`);
    await shot("hero");
  }

  // ======================= projects-layout =======================
  if (on("projects-layout")) {
    setGroup("projects-layout");
    await row();
    const head = await R("#shelf-title");
    const label = await R(".shelf-label");
    const toggle = await R(".mode-toggle");
    check("records: Projects heading fully on screen", onScreenX(head), JSON.stringify([head?.l | 0, head?.r | 0]));
    check('records: "Pick a record" label has a rect and is visible', onScreenX(label) && label.vis === "visible", JSON.stringify(label));
    check("records: Records / List toggle has a rect and is visible", onScreenX(toggle) && toggle.vis === "visible", JSON.stringify(toggle));
    await noHScroll("records");
    await shot("records");
    // the row hangs just under the toggle line (no big gap on tall screens), no sleeve is cut off, and the section ends before About
    const caps = await val("[...document.querySelectorAll('.sleeve-cap')].map((e)=>{const r=e.getBoundingClientRect();return {l:r.left,t:r.top,w:r.width,h:r.height}})");
    const firstTop = Math.min(...caps.map((c) => c.t));
    const gapPx = firstTop - toggle.b;
    check("records: gap between the toggle line and the sleeves under 6rem", gapPx > 0 && gapPx < 96, `${gapPx | 0}px`);
    check("records: all four sleeves on screen", caps.length === 4 && caps.every((c) => c.l >= 0 && c.l + c.w <= w), caps.map((c) => `${c.l | 0}+${c.w | 0}`).join(" "));
    const sectionEnd = await val("[document.getElementById('shelf').getBoundingClientRect().bottom, document.getElementById('about').getBoundingClientRect().top]");
    check("records: Projects ends before About starts", sectionEnd[0] <= sectionEnd[1] + 1, JSON.stringify(sectionEnd));
    // hover each sleeve with the real pointer: it becomes the active one
    for (let i = 0; i < caps.length; i++) {
      const c = caps[i];
      await mouse("mouseMoved", Math.round(c.l + c.w / 2), Math.round(c.t + c.w / 2));
      await until(`[...document.querySelectorAll('.track')].findIndex((t)=>t.classList.contains('is-active')) === ${i}`, 1500);
      const active = await val("[...document.querySelectorAll('.track')].findIndex((t)=>t.classList.contains('is-active'))");
      check(`records: pointer over sleeve ${i + 1} hovers it`, active === i, `active ${active}`);
    }
    await mouse("mouseMoved", 5, 5);
  }

  // ======================= list-mode =======================
  if (on("list-mode")) {
    setGroup("list-mode");
    await row();
    await val("document.querySelector('[data-mode=list]').click()");
    await sleep(1500);
    check("list: label and toggle visible", onScreenX(await R(".shelf-label")) && onScreenX(await R(".mode-toggle")));
    if (wantShots) {
      const y0 = await val("scrollY");
      await val("window.scrollBy(0, document.querySelector('.row').getBoundingClientRect().top - 90)");
      await sleep(400);
      await shot("notes-closed");
      await val("document.querySelector('.row-more summary').click()");
      await sleep(600);
      await shot("notes-open");
      await val("document.querySelector('.row-more summary').click()");
      await sleep(500);
      await val(`window.scrollTo(0, ${y0})`);
      await sleep(300);
    }
    // the first row's notes: a visible control that opens the numbered notes inside the row, without moving the thumbnail
    const notes = await val(`(async()=>{const li=document.querySelector('.row');const d=li.querySelector('.row-more');const sum=d.querySelector('summary');const thumb=li.querySelector('.row-thumb');const rect=(e)=>{const r=e.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width,h:r.height}};const sr=rect(sum);const color=getComputedStyle(sum).color;const border=parseFloat(getComputedStyle(sum).borderTopWidth);const textClosed=sum.innerText.trim().replace(/\\s+/g,' ');const thumbTop=thumb?rect(thumb).t:null;sum.click();await new Promise(r=>setTimeout(r,600));const open=d.open;const textOpen=sum.innerText.trim().replace(/\\s+/g,' ');const t=d.querySelector('.panel-track');const tr=rect(t);const row=rect(li);const next=li.nextElementSibling?rect(li.nextElementSibling):null;const thumbTop2=thumb?rect(thumb).t:null;const names=[...d.querySelectorAll('.track-name')].map((e)=>e.textContent.trim().slice(0,2));const sw=document.documentElement.scrollWidth;sum.click();await new Promise(r=>setTimeout(r,500));return {sr,color,border,textClosed,textOpen,open,tr,row,next,thumbTop,thumbTop2,names,sw,closed:!d.open}})()`);
    check('list: "More information" is a pill button (44px tall, border, label follows the state)', notes.sr.w > 0 && notes.sr.h >= 44 && notes.border >= 1 && notes.textClosed === "More information" && notes.textOpen === "Hide information", `${notes.sr.w | 0}x${notes.sr.h | 0}, border ${notes.border}px, "${notes.textClosed}" / "${notes.textOpen}"`);
    check("list: the notes open as the numbered notes inside the row, thumbnail stays put, no overlap with the next row, no sideways scroll", notes.open && notes.names.join() === "01,02,03" && notes.tr.w > 0 && notes.tr.l >= notes.row.l - 0.5 && notes.tr.r <= notes.row.r + 0.5 && notes.tr.b <= notes.row.b + 0.5 && (!notes.next || notes.row.b <= notes.next.t + 0.5) && notes.thumbTop === notes.thumbTop2 && notes.sw <= w && notes.closed, JSON.stringify({ open: notes.open, names: notes.names, notesInRow: notes.tr.b <= notes.row.b, thumb: [notes.thumbTop, notes.thumbTop2], sw: notes.sw, closed: notes.closed }));
    // list thumbnails: whole picture (same shape as the file), inside its row, clear of the text column; the notes hold no image
    const thumbs = await val(`(async()=>{const out=[];for(const li of document.querySelectorAll('.row')){const img=li.querySelector('.row-thumb-img');const body=li.querySelector('.row-body');const vis=img&&getComputedStyle(img.closest('.row-thumb')).display!=='none';if(img&&!img.complete){img.loading='eager';await new Promise(r=>{img.onload=r;img.onerror=r;setTimeout(r,4000)})}const rr=(e)=>{const r=e.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width,h:r.height}};const text=[...body.children].filter((e)=>!e.classList.contains('row-thumb')).map(rr);out.push({vis,img:vis?rr(img.closest('.row-thumb')):null,nat:img?img.naturalWidth/img.naturalHeight:null,shape:vis?rr(img):null,row:rr(li),text,notesImg:li.querySelectorAll('.row-more img').length,fit:vis?getComputedStyle(img).objectFit:null})}return out})()`);
    thumbs.forEach((t, k) => {
      if (!t.vis) return check(`list row ${k + 1}: no thumbnail shown (text takes the row)`, false, "thumbnail hidden");
      const shapeOk = Math.abs(t.shape.w / t.shape.h / t.nat - 1) <= 0.01 && t.fit !== "cover";
      const inRow = t.img.l >= t.row.l - 0.5 && t.img.r <= t.row.r + 0.5 && t.img.t >= t.row.t - 0.5 && t.img.b <= t.row.b + 0.5;
      const clear = t.text.every((x) => !(x.l < t.img.r - 0.5 && t.img.l < x.r - 0.5 && x.t < t.img.b - 0.5 && t.img.t < x.b - 0.5));
      check(`list row ${k + 1}: thumbnail whole, inside the row, clear of the text`, shapeOk && inRow && clear && t.notesImg === 0, `shape ${(t.shape.w / t.shape.h).toFixed(3)}/${t.nat.toFixed(3)}, inRow ${inRow}, clear ${clear}, notes images ${t.notesImg}`);
    });
    check("list: rows shown", (await val("document.querySelectorAll('.row-head').length")) === 4 && (await R(".row-head")).w > 0);
    await noHScroll("list");
    await shot("list");
  }

  // ======================= open-record / player / live (one pass over the four records) =======================
  const inside = (r, clipTop, clipBottom) => r && r.l >= -0.5 && r.r <= w + 0.5 && r.t >= clipTop - 0.5 && r.b <= clipBottom + 0.5;
  const overlap = (a, b) => a && b && a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
  if (on("open-record") || on("player") || on("live")) {
    if (on("open-record")) {
      setGroup("open-record");
      // the first open: the last sleeve (Music Bot) clicked with the real pointer
      await row();
      const sleeves = await val("[...document.querySelectorAll('.sleeve-cap')].map((e)=>{const r=e.getBoundingClientRect();return {l:r.left,t:r.top,w:r.width}})");
      const last = sleeves[sleeves.length - 1];
      await clickAt(Math.round(last.l + last.w / 2), Math.round(last.t + last.w / 2));
      await until(`${STATE} === 'playing'`, 12000);
      await settle(4000);
      await sleep(1500);
      const state = await val(STATE);
      check("record opens (state)", state === "playing", state);
      const panel = await R(".panel:not([hidden])");
      check("open: info panel visible with a rect inside the viewport", onScreenX(panel) && panel.vis === "visible", JSON.stringify(panel));
      const title = await R(".panel:not([hidden]) .panel-title");
      check("open: panel title visible", onScreenX(title), JSON.stringify(title));
      if (!stacked) {
        const frame = await R("#demo-frame");
        check("open: demo frame inside the viewport", onScreenX(frame) && frame.disp !== "none", JSON.stringify(frame));
        check("open: frame top aligned with the panel top (+-24px)", Math.abs(frame.t - panel.t) <= 24, `frame ${frame.t | 0} / panel ${panel.t | 0}`);
        const hidden = await val("[document.querySelector('.section-head'),document.querySelector('.shelf-label'),document.querySelector('.mode-toggle')].map((e)=>getComputedStyle(e).visibility).join()");
        check("open: heading, label and toggle hidden", hidden === "hidden,hidden,hidden", hidden);
      }
      await noHScroll("open record");
      await shot("open");
    }
    for (let i = 0; i < 4; i++) {
      setGroup(on("open-record") ? "open-record" : on("player") ? "player" : "live");
      await open(i);
      const pr = await val("window.__shelf.projected()");
      const m = /inset\(([\d.]+)px [\d.]+px ([\d.]+)px/.exec(pr.clip ?? "");
      const clipTop = m ? +m[1] : 0;
      const clipBottom = pr.view[1] - (m ? +m[2] : 0);
      if (on("open-record")) {
        setGroup("open-record");
        const rr = pr.record;
        check(`record ${i + 1}: playing`, pr.state === "playing", pr.state);
        // The turntable is deliberately cropped by the window's edge on wide screens, so the disc may be partly off; its centre label and at
        // least 60% of its width and height must be inside the viewport and the clip
        const share = (lo, hi, a, b) => Math.max(0, Math.min(hi, b) - Math.max(lo, a)) / (hi - lo);
        const okRecord = rr && rr.cx >= 0 && rr.cx <= w && rr.cy >= clipTop && rr.cy <= clipBottom && share(rr.cx - rr.r, rr.cx + rr.r, 0, w) >= 0.6 && share(rr.cy - rr.r, rr.cy + rr.r, clipTop, Math.min(clipBottom, pr.view[1])) >= 0.6;
        check(`record ${i + 1}: the record is on screen and inside the canvas clip`, okRecord, rr ? `centre ${rr.cx | 0},${rr.cy | 0} radius ${rr.r | 0}, clip y ${clipTop | 0}-${clipBottom | 0}` : "not found");
        check(`record ${i + 1}: the record is big enough (radius)`, rr && rr.r >= (w >= 768 ? 60 : 40), rr ? `radius ${rr.r | 0}px` : "");
        // the screenshot is shown whole: its box has the picture's own shape (object-fit: contain then adds no bars)
        const shotRatio = await val(`(()=>{const img=${JSON.stringify(stacked ? ".panel:not([hidden]) .panel-shot" : ".demo-img.is-front")};const e=document.querySelector(img);if(!e||!e.naturalWidth)return null;const r=e.getBoundingClientRect();return [r.width/r.height,e.naturalWidth/e.naturalHeight,getComputedStyle(e).objectFit]})()`);
        check(`record ${i + 1}: screenshot not cropped (shape within 1%)`, shotRatio && Math.abs(shotRatio[0] / shotRatio[1] - 1) <= 0.01 && shotRatio[2] !== "cover", JSON.stringify(shotRatio));
        if (stacked && pr.table) {
          const sec = await R("#shelf");
          const tc = (pr.table.l + pr.table.r) / 2;
          const sc = (sec.l + sec.r) / 2;
          check(`record ${i + 1}: stacked: the turntable is centred on the section (8%)`, Math.abs(tc - sc) <= 0.08 * sec.w, `turntable ${tc | 0} / section ${sc | 0}`);
        }
        if (!stacked) check(`record ${i + 1}: the collapsed stack is inside the clip`, inside(pr.stack, clipTop, clipBottom), pr.stack ? `${pr.stack.l | 0},${pr.stack.t | 0} - ${pr.stack.r | 0},${pr.stack.b | 0}` : "not found");
        if (i === 1) await shot("open-expense");
        if (i === 0) await shot("open-rag");
      }
      if (on("player")) {
        setGroup("player");
        // the mini player: shown, inside the section, clear of the frame and the panel, big enough to tap; pause stops the record
        const pl = await val(`(()=>{const q=(s)=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width,h:r.height}};return {player:q('[data-player]'),frame:${stacked ? "null" : "q('#demo-frame')"},panel:q('.panel:not([hidden])'),shelf:q('#shelf'),o:+getComputedStyle(document.querySelector('[data-player]')).opacity,vis:getComputedStyle(document.querySelector('[data-player]')).visibility,btns:[...document.querySelectorAll('.player-btn')].map((b)=>b.getBoundingClientRect().height)}})()`);
        check(`record ${i + 1}: player shown`, pl.player && pl.player.w > 0 && pl.o > 0.95 && pl.vis === "visible", `opacity ${pl.o}`);
        check(`record ${i + 1}: player inside the section and the window's width`, pl.player.t >= pl.shelf.t && pl.player.b <= pl.shelf.b && pl.player.l >= 0 && pl.player.r <= w, JSON.stringify([pl.player.t | 0, pl.player.b | 0, pl.shelf.t | 0, pl.shelf.b | 0]));
        if (!stacked) check(`record ${i + 1}: player inside the window (side by side)`, pl.player.b <= h, `${pl.player.b | 0}`);
        check(`record ${i + 1}: player clear of the frame and the panel`, !overlap(pl.player, pl.frame) && !overlap(pl.player, pl.panel), "");
        const geo = await val(`(()=>{const q=(s)=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom}};return {bar:q('.player-bar'),frame:q('#demo-frame'),shot:q('.panel:not([hidden]) .panel-shot'),thumbs:q('.thumbs')}})()`);
        if (!stacked) {
          check(`record ${i + 1}: progress bar as wide as the frame`, Math.abs(geo.bar.l - geo.frame.l) <= 2 && Math.abs(geo.bar.r - geo.frame.r) <= 2, `bar ${geo.bar.l | 0}-${geo.bar.r | 0} / frame ${geo.frame.l | 0}-${geo.frame.r | 0}`);
        } else {
          check(`record ${i + 1}: player between the turntable and the thumbnails`, pr.table && pl.player.t >= pr.table.b - 0.5 && pl.player.b <= geo.thumbs.t + 0.5 && !overlap(pl.player, geo.thumbs), `turntable bottom ${pr.table?.b | 0}, player ${pl.player.t | 0}-${pl.player.b | 0}, thumbs top ${geo.thumbs.t | 0}`);
          check(`record ${i + 1}: progress bar as wide as the screenshot`, geo.shot && Math.abs(geo.bar.l - geo.shot.l) <= 2 && Math.abs(geo.bar.r - geo.shot.r) <= 2, `bar ${geo.bar.l | 0}-${geo.bar.r | 0} / shot ${geo.shot?.l | 0}-${geo.shot?.r | 0}`);
          if (i === 0) {
            // the "All records" pill never covers the thumbnails, wherever the page is scrolled
            const hits = [];
            const y0 = await val("scrollY");
            for (const dy of [0, 120, 260, 420, 700]) {
              const o = await val(`(()=>{window.scrollTo(0, ${y0 + dy});const a=document.getElementById('eject').getBoundingClientRect(),b=document.querySelector('.thumbs').getBoundingClientRect();return a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom})()`);
              if (o) hits.push(dy);
            }
            await val(`window.scrollTo(0, ${y0})`);
            check('stacked: the "All records" pill never covers the thumbnails', hits.length === 0, hits.length ? `overlaps at +${hits.join(", +")}px` : "");
          }
        }
        check(`record ${i + 1}: player buttons at least 44px`, pl.btns.length === 3 && pl.btns.every((x) => x >= 44), JSON.stringify(pl.btns));
        if (i === 0) {
          await val("document.querySelector('[data-player-toggle]').click()");
          await sleep(300);
          const a1 = await val("window.__shelf.projected().angle");
          await sleep(900);
          const a2 = await val("window.__shelf.projected().angle");
          const pressed = await val("document.querySelector('[data-player-toggle]').getAttribute('aria-pressed')+'|'+document.querySelector('[data-player-toggle]').getAttribute('aria-label')");
          check("player: pause stops the record and sets aria-pressed", a1 === a2 && pressed === "true|Play", `${a1} / ${a2}, ${pressed}`);
          await shot("player-paused");
          await val("document.querySelector('[data-player-toggle]').click()");
          await sleep(900);
          const a3 = await val("window.__shelf.projected().angle");
          check("player: play turns it again", a3 !== a2 && (await val("document.querySelector('[data-player-toggle]').getAttribute('aria-pressed')")) === "false", `${a2} -> ${a3}`);
          await shot("player-playing");
        }
      }
      // The live demo must never move the page: a stub app that scrolls itself into view and focuses its input on load and on every click
      if (on("live") && !stacked && (await val("!document.querySelector('[data-live-start]').hidden"))) {
        setGroup("live");
        await val("document.querySelector('[data-live-start]').click()");
        await sleep(700);
        const y0 = await val("scrollY");
        await val(`(()=>{const f=document.querySelector('.demo-live iframe');f.removeAttribute('src');f.srcdoc='<body style="margin:0;height:3000px"><input id=i style="position:absolute;top:100px"><div id=end style="position:absolute;top:2900px">end</div><script>const go=()=>{document.getElementById("end").scrollIntoView({block:"start"});document.getElementById("i").focus()};addEventListener("load",go);addEventListener("click",go)<\\/script>'})()`);
        await sleep(1200);
        const fr = await R(".demo-live iframe");
        for (let k = 0; k < 3; k++) {
          await clickAt(Math.round(fr.l + fr.w * (0.3 + 0.2 * k)), Math.round(fr.t + fr.h * 0.5));
          await sleep(500);
        }
        const y1 = await val("scrollY");
        check(`record ${i + 1}: live frame: clicks and focus inside do not move the page`, Math.abs(y1 - y0) <= 4, `${y0} -> ${y1}`);
        const frAfter = await R("#demo-frame");
        const aboutTop = await val("document.getElementById('about').getBoundingClientRect().top");
        check(`record ${i + 1}: live frame still on screen and above About`, frAfter.t >= 0 && frAfter.b <= h && frAfter.b <= aboutTop + 1, `frame ${frAfter.t | 0}-${frAfter.b | 0}, About at ${aboutTop | 0}`);
        if (i === 0) {
          // never stuck: a scroll the visitor made that ended outside the open section lets go of the lock on the next try, and the wheel works
          await val("(()=>{window.dispatchEvent(new WheelEvent('wheel',{deltaY:1}));window.scrollTo({top:scrollY+innerHeight*1.4,behavior:'instant'})})()");
          await sleep(300);
          await val("window.dispatchEvent(new WheelEvent('wheel',{deltaY:1}))");
          await sleep(300);
          const cls = await val("document.documentElement.className");
          const a = await val("scrollY");
          await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 20, y: 300, deltaX: 0, deltaY: 200 });
          await sleep(700);
          const b = await val("scrollY");
          check("live frame: not stuck after the page was scrolled out of the section (lock released, wheel scrolls)", !/shelf-locked|demo-live/.test(cls) && b > a, `${cls || "no lock"}; ${a | 0} -> ${b | 0}`);
          await val("document.getElementById('shelf').scrollIntoView({block:'center'})");
          await sleep(900);
        }
        await val("document.querySelector('[data-live-back]').click()");
        await sleep(500);
      }
    }
  }

  // ======================= touch: switching by clicking / tapping the stack =======================
  if (on("touch") && !stacked) {
    setGroup("touch");
    // With a record open the other sleeves (the stack on the left) can be clicked to switch records: with a real mouse (hover spreads
    // the stack, then a click) and with taps (the first tap spreads it, then the next one picks), wherever they really are
    const slugsAll = await slugs();
    const reopen = async () => {
      await val("document.querySelectorAll('.track')[0].click()");
      await until(`location.hash === '#/projects/${slugsAll[0]}' && ${STATE} === 'playing'`, 9000);
      await sleep(600);
    };
    const switchTo = async (p, how) => {
      let cs = await val("window.__shelf.sleeveCentres()");
      const mid = cs[Math.floor(cs.length / 2)];
      if (how === "touch") await tapAt(mid.x, mid.y);
      else await mouse("mouseMoved", mid.x, mid.y);
      await sleep(1400);
      cs = await val("window.__shelf.sleeveCentres()");
      const c = cs.find((q) => q.i === p);
      const top = await val(`(e=>e?e.tagName+'.'+(e.className.baseVal??e.className):'null')(document.elementFromPoint(${c.x},${c.y}))`);
      if (how === "touch") await tapAt(c.x, c.y);
      else {
        await mouse("mouseMoved", c.x, c.y);
        await sleep(400);
        await mouse("mousePressed", c.x, c.y);
        await mouse("mouseReleased", c.x, c.y);
      }
      await until(`location.hash === '#/projects/${slugsAll[p]}' && ${STATE} === 'playing'`, 9000);
      const hash = await val("location.hash");
      check(`switch records by clicking the stack: ${how} on project ${p + 1}`, hash === `#/projects/${slugsAll[p]}`, `at ${c.x | 0},${c.y | 0}, on top: ${top}, now ${hash}`);
      await sleep(600);
    };
    await open(0);
    for (const p of [1, 2, 3]) {
      await switchTo(p, "mouse");
      await reopen();
    }
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    for (const p of [1, 2, 3]) {
      await switchTo(p, "touch");
      await reopen();
    }
    await send("Emulation.setTouchEmulationEnabled", { enabled: false });
  }

  // ======================= swap =======================
  if (on("swap")) {
    setGroup("swap");
    // Switching records with one open: the turntable stays where it is, and the HTML (player, frame, panel) is out of sight while the
    // records move. Sampled every ~60 ms from inside the page.
    await open(0);
    // what the visitor sees of the record: the title bar address, the screenshot, the "Now playing" line (and the panel's title)
    const contentJs = "(()=>({host:document.querySelector('[data-demo-host]')?.textContent??'',img:(document.querySelector('.demo-img.is-front')?.getAttribute('src'))??'',status:document.getElementById('shelf-status').textContent,title:document.querySelector('.panel:not([hidden]) .panel-title')?.textContent??''}))()";
    const oldContent = await val(contentJs);
    await val(`(()=>{window.__sw=[];const content=()=>${contentJs};const t0=performance.now();window.__swDone=false;document.querySelector('[data-player-next]').click();const f=()=>{const p=window.__shelf.projected();const pl=document.querySelector('[data-player]');const cs=getComputedStyle(pl);const fr=getComputedStyle(document.getElementById('demo-frame'));window.__sw.push({t:performance.now()-t0,state:document.getElementById('shelf').dataset.state,x:p.platter?.x,y:p.platter?.y,o:+cs.opacity,vis:cs.visibility,fo:+fr.opacity,fvis:fr.visibility,c:content(),tb:p.table&&{l:p.table.l,t:p.table.t}});if(performance.now()-t0<4200)setTimeout(f,60);else window.__swDone=true};f()})()`);
    await sleep(900);
    await shot("swap-mid");
    await until("window.__swDone === true", 6000);
    const sw = await val("window.__sw");
    const during = sw.filter((q) => q.state === "transitioning");
    const spanX = Math.max(...sw.map((q) => q.x)) - Math.min(...sw.map((q) => q.x));
    const spanY = Math.max(...sw.map((q) => q.y)) - Math.min(...sw.map((q) => q.y));
    check(`swap: the turntable stays put (platter moved ${spanX.toFixed(1)} x ${spanY.toFixed(1)} px)`, spanX <= 3 && spanY <= 3 && during.length > 5, `${during.length} samples while the records moved`);
    // The scene starts moving records only once the fade-out has finished, so: the player is fully hidden within 600 ms of the click and
    // stays hidden for the rest of the swap (a jittery sample while it is still fading out does not count)
    const hiddenAt = during.findIndex((q) => q.o <= 0.02);
    const laterVisible = hiddenAt < 0 ? [] : during.slice(hiddenAt).filter((q) => q.o > 0.02);
    check("swap: the player is hidden (within 600 ms) before the records move, and stays hidden", hiddenAt >= 0 && during[hiddenAt].t <= 600 && laterVisible.length === 0, hiddenAt < 0 ? "never hidden" : `hidden from ${during[hiddenAt].t | 0} ms until ${Math.max(...during.map((q) => q.t)) | 0} ms${laterVisible.length ? `; visible again at ${laterVisible.slice(0, 3).map((q) => `${q.t | 0}ms:${q.o.toFixed(2)}`).join(", ")}` : ""}`);
    const swLast = sw[sw.length - 1];
    // Nothing of the new record shows while the old content is still on screen (fading out), and nothing of the old one when the new one fades in
    const newContent = swLast.c;
    const shown = (q) => q.o > 0.02 && q.vis === "visible";
    const same = (a, b) => a.status === b.status && (stacked || (a.host === b.host && a.img === b.img));
    const earlyNew = sw.filter((q) => q.state === "transitioning" && shown(q) && !same(q.c, oldContent));
    const lateOld = sw.filter((q) => q.state === "playing" && shown(q) && !same(q.c, newContent));
    check("swap: the old record's content stays until everything is hidden, the new content only shows when it fades in", oldContent.status !== newContent.status && earlyNew.length === 0 && lateOld.length === 0, `old "${oldContent.status}" ${oldContent.host} / new "${newContent.status}" ${newContent.host}; new content visible too early in ${earlyNew.length} samples${earlyNew[0] ? ` (first at ${earlyNew[0].t | 0} ms: ${JSON.stringify(earlyNew[0].c)})` : ""}; old content visible too late in ${lateOld.length}`);
    if (!stacked) {
      const frameShownEarly = sw.filter((q) => q.state === "transitioning" && q.fo > 0.02 && q.fvis === "visible" && !same(q.c, oldContent));
      check("swap: the frame never shows the new screenshot or address before its fade-in", frameShownEarly.length === 0, `${frameShownEarly.length} samples`);
    }
    // the phases, from the scene's own clock (SWAP_IN_PLACE in tweaks.js): HTML out + beat, the old record back, the gap, the new record forward
    const T = await val("window.__swapT");
    const ms = (a, b) => Math.round(b - a);
    const phases = { out: ms(T.click, T.begin), back: ms(T.begin, T.backEnd), gap: ms(T.backEnd, T.newStart) };
    const tPlaying = sw.find((q) => q.state === "playing")?.t;
    const tVisible = sw.find((q) => q.state === "playing" && q.o > 0.95)?.t;
    phases.forward = Math.round(tPlaying - (T.newStart - T.click));
    console.log(`      [${currentSize}] swap phases (ms): HTML out + beat ${phases.out}, old record back ${phases.back}, gap ${phases.gap}, new record forward ~${phases.forward}; playing at ${tPlaying | 0}, HTML back at ${tVisible | 0}`);
    check("swap: click to playing under 2.4 s and the player fully back within 2.6 s", tPlaying <= 2400 && tVisible <= 2600 && tPlaying >= 1500, `playing at ${tPlaying | 0} ms, player back at ${tVisible | 0} ms`);
    check("swap: the player is back after the new record is playing", swLast.state === "playing" && swLast.o > 0.95, `${swLast.state}, opacity ${swLast.o}`);
  }

  // ======================= player: next / previous =======================
  if (on("player")) {
    setGroup("player");
    // previous / next go round the projects in order
    const slugsList = await slugs();
    await open(3); // (the last record, so Next wraps round)
    await val("document.querySelector('[data-player-next]').click()");
    await until(`location.hash === '#/projects/${slugsList[0]}' && ${STATE} === 'playing'`, 9000);
    check("player: next plays the next project (wrapping)", (await val("location.hash")) === `#/projects/${slugsList[0]}` && (await val(STATE)) === "playing", await val("location.hash"));
    await sleep(600);
    await val("document.querySelector('[data-player-prev]').click()");
    await until(`location.hash === '#/projects/${slugsList[3]}' && ${STATE} === 'playing'`, 9000);
    check("player: previous goes back", (await val("location.hash")) === `#/projects/${slugsList[3]}`, await val("location.hash"));
  }

  // ======================= back =======================
  if (on("back")) {
    setGroup("back");
    // "All records": after a swap (a record that came from the in-place swap) and after a plain open must look the same: the turntable
    // stays where it is and fades out, it never slides to the middle of the screen. The platter is sampled every ~60 ms during Back.
    const backRun = async (label, shotName) => {
      await val(`(()=>{window.__bk=[];const t0=performance.now();window.__bkDone=false;document.getElementById('eject').click();const f=()=>{const p=window.__shelf.projected();window.__bk.push({t:performance.now()-t0,state:document.getElementById('shelf').dataset.state,x:p.platter?.x,y:p.platter?.y,sy:document.getElementById('shelf').getBoundingClientRect().top,vis:p.tableVisible});if(performance.now()-t0<4200)setTimeout(f,60);else window.__bkDone=true};f()})()`);
      await sleep(450);
      if (shotName) await shot(shotName);
      await until("window.__bkDone === true", 6000);
      const samples = (await val("window.__bk")).filter((q) => q.state !== "stack" && q.vis > 0.05); // (while the turntable is on screen at all)
      // (positions relative to the section: the page itself may scroll back to the section while Back runs, and the two flows may have been
      // opened at different scroll positions)
      const x0 = samples[0].x;
      const y0 = samples[0].y - samples[0].sy;
      const far = Math.max(...samples.map((q) => Math.hypot(q.x - x0, q.y - q.sy - y0)));
      const nearMiddle = samples.filter((q) => Math.hypot(q.x - w / 2, q.y - h / 2) < 0.25 * w);
      await sleep(1200);
      return { label, x0, y0, yv0: samples[0].y, far, nearMiddle: nearMiddle.length, n: samples.length };
    };
    await open(0);
    const firstSlug = (await slugs())[0];
    await val("document.querySelector('[data-player-next]').click()"); // a swap, then Back
    await until(`${STATE} === 'playing' && location.hash !== '#/projects/${firstSlug}'`, 9000);
    await sleep(900);
    const flowSwap = await backRun("open -> swap -> Back", "back-mid-after-swap");
    await open(2); // a plain open from the row
    const flowPlain = await backRun("open -> Back", "back-mid-plain");
    for (const f of [flowPlain, flowSwap]) {
      check(`back (${f.label}): the turntable stays put (moved at most ${f.far.toFixed(1)} px from ${f.x0 | 0},${f.y0 | 0})`, f.far <= 8 && f.n > 8, `${f.n} samples`);
      if (!stacked) check(`back (${f.label}): the platter never comes within 25% of the screen width of the middle`, f.nearMiddle === 0, `${f.nearMiddle} samples near the middle`);
    }
    check("back: both flows start from the same turntable position", Math.hypot(flowPlain.x0 - flowSwap.x0, flowPlain.yv0 - flowSwap.yv0) <= 6, `plain ${flowPlain.x0 | 0},${flowPlain.yv0 | 0} / after a swap ${flowSwap.x0 | 0},${flowSwap.yv0 | 0} (on screen)`);
    await sleep(500);
    const back = await val("(()=>{const s=document.getElementById('shelf').getBoundingClientRect();const caps=[...document.querySelectorAll('.cap-text')].map((e)=>e.getBoundingClientRect().bottom);return {top:s.top,bottom:s.bottom,capsBottom:Math.max(...caps),on:document.querySelectorAll('.sleeve-cap.is-on').length,h:document.getElementById('shelf').style.height}})()");
    check("back: captions inside the section, height released", back.capsBottom <= back.bottom && back.on === 4 && back.h === "", JSON.stringify(back));
    await shot("back");
    const after = await R(".mode-toggle");
    check("closed again: toggle visible", onScreenX(after) && after.vis === "visible");
  }

  // ======================= titles / about / contact =======================
  if (on("titles") && w < 1100) {
    setGroup("titles");
    for (const id of ["shelf", "about", "contact"]) {
      const t = await R(`#${id} .section-title`);
      const hd = await R(`#${id} .section-head`);
      check(`${id}: title starts at the rule's left edge and fits`, t && hd && Math.abs(t.l - hd.l) <= 1 && t.r <= w, `title ${t?.l | 0}-${t?.r | 0} / rule ${hd?.l | 0}`);
    }
  }
  const gotoSection = async (name) => {
    dirty = true;
    if ((await val(STATE)) !== "stack") {
      await val("document.getElementById('eject').click()");
      await until(`${STATE} === 'stack'`, 12000);
    }
    await val(`document.querySelector('[data-nav=${name}]').click()`);
    await settle();
    await sleep(300);
  };
  if (on("about")) {
    setGroup("about");
    await gotoSection("about");
    const t = await R("#about-title");
    check("about: title fully on screen", onScreenX(t) && t.t >= 40, JSON.stringify([t?.l | 0, t?.r | 0, t?.t | 0]));
    await noHScroll("about");
    // the longer About copy fits its card: the text ends inside its tile (the decorative drawings are cropped by the tile on purpose, so only the text is measured)
    const tiles = await val("[...document.querySelectorAll('.about-tile')].map((t)=>{const p=t.querySelector('p').getBoundingClientRect(),r=t.getBoundingClientRect();return {id:t.className.replace('about-tile about-tile--',''),pb:p.bottom,tb:r.bottom,pr:p.right,tr:r.right}})");
    const bars = await val("(()=>{const t=document.querySelector('.about-tile--build');const m=t.querySelector('.about-motif').getBoundingClientRect(),p=t.querySelector('p').getBoundingClientRect(),r=t.getBoundingClientRect();return {barsTop:r.bottom-m.height*0.55,textBottom:p.bottom}})()"); // (the bars fill about the lower half of their drawing, which the tile crops at its bottom edge)
    check("about: the What I build text ends above the bar drawing", bars.textBottom <= bars.barsTop + 0.5, `${bars.textBottom | 0} / ${bars.barsTop | 0}`);
    check("about: all four cards hold their text", tiles.length === 4 && tiles.every((t) => t.pb <= t.tb + 0.5 && t.pr <= t.tr + 0.5), tiles.map((t) => `${t.id} ${t.pb | 0}/${t.tb | 0}`).join(", "));
    await shot("about");
  }
  if (on("contact")) {
    setGroup("contact");
    await gotoSection("contact");
    const t = await R("#contact-title");
    check("contact: title fully on screen", onScreenX(t) && t.t >= 40, JSON.stringify([t?.l | 0, t?.r | 0, t?.t | 0]));
    await noHScroll("contact");
    const col = await R(".contact-item");
    const hd = await R("#contact .section-head");
    if (w < 1100) check("contact: title, rule and first column share the left edge", Math.abs(col.l - hd.l) <= 1 && Math.abs(t.l - hd.l) <= 1, `title ${t.l | 0}, rule ${hd.l | 0}, column ${col.l | 0}`);
    const lines = await val("[...document.querySelectorAll('.contact-link')].map((e)=>[e.textContent,e.getBoundingClientRect().height,parseFloat(getComputedStyle(e).lineHeight),e.getBoundingClientRect().right,e.parentElement.getBoundingClientRect().right])");
    for (const [text, hh, lh, right, colRight] of lines) check(`contact: "${text}" on one line and inside its column`, hh < 1.6 * lh && right <= colRight + 0.5, `h ${hh | 0} / line ${lh | 0}, right ${right | 0} / col ${colRight | 0}`);
  }

  setGroup("errors");
  check("no page errors", errors.length === 0, errors[0] ?? "");
}

// ---- go ------------------------------------------------------------------------------------------------------------
const runnable = sizes.filter(([w, h]) => ORDER.some((g) => g !== "errors" && selected.has(g) && applies(g, w, h)));
if (wantShots) {
  rmSync(shotsDir, { recursive: true, force: true });
  mkdirSync(shotsDir, { recursive: true });
}
const started = Date.now();
const tmpBefore = dirSize(join(root, ".tmp"));
console.log(`${quick ? "quick: " : ""}${runnable.length} size(s): ${runnable.map(([w, h]) => `${w}x${h}`).join(", ") || "none"}; groups: ${chosen.join(", ")}`);
let browser = null;
const sizeMs = {};
try {
  if (runnable.length) browser = await startBrowser();
  for (const size of runnable) {
    const t0 = Date.now();
    await run(browser, size);
    sizeMs[`${size[0]}x${size[1]}`] = Date.now() - t0;
  }
} catch (err) {
  currentSize = "-";
  setGroup("errors");
  check("the run itself", false, String(err.message ?? err));
} finally {
  clearTimeout(globalTimer);
  setGroup("");
  const profileSize = dirSize(profileDir);
  try {
    browser?.close();
  } catch {}
  killBrowser();
  await sleep(1000); // let the browser exit and let go of its files
  cleanup();
  const secs = (ms) => `${(ms / 1000).toFixed(0)} s`;
  console.log("\ntime per group:  " + ORDER.filter((g) => groupMs[g]).map((g) => `${g} ${secs(groupMs[g])}`).join(" | "));
  console.log("time per size:   " + Object.entries(sizeMs).map(([s, ms]) => `${s} ${secs(ms)}`).join(" | "));
  for (const line of failures) console.log(line);
  console.log(`\nbrowser profile ${mb(profileSize)} (deleted); screenshots ${wantShots ? `${shotCount} in .tmp/check-shots, ${mb(dirSize(shotsDir))}` : "off (--shots)"}; .tmp before ${mb(tmpBefore)}, after ${mb(dirSize(join(root, ".tmp")))}`);
  console.log(`${failed ? "FAILED" : "ok"}: ${passed} passed, ${failed} failed, ${secs(Date.now() - started)} total`);
}
process.exit(failed ? 1 : 0);
