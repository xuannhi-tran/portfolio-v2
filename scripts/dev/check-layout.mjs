// Dev-only layout check (not part of the build): drives headless Edge over the DevTools protocol against a running dev
// server and asserts the things that an overflow / clipping change can silently break.
//   npm run dev            (in another terminal)
//   node scripts/dev/check-layout.mjs [http://localhost:5173] [shots-dir]
// Per viewport: no horizontal scroll (home, records, list, open record); the Projects heading, the "Pick a record" label and
// the Records / List toggle are on screen in records and list mode; with a record open the demo frame is inside the viewport
// and the info panel is visible. Exit code 1 if anything fails. EDGE=<path> overrides the browser.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] ?? "http://localhost:5173";
const shots = process.argv[3];
if (shots) mkdirSync(shots, { recursive: true });
const edge = process.env.EDGE ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const sizes = [
  [1440, 900],
  [1920, 1080],
  [440, 900],
  [390, 844],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
};

async function run([w, h]) {
  const port = 9400 + w % 100;
  const proc = spawn(
    edge,
    ["--headless=new", `--remote-debugging-port=${port}`, "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--hide-scrollbars", `--user-data-dir=${join(tmpdir(), "layout-check-" + Date.now() + "-" + w)}`, "about:blank"],
    { stdio: "ignore" },
  );
  let targets;
  for (let i = 0; i < 40; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      if (targets.length) break;
    } catch {}
    await sleep(250);
  }
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) pending.get(d.id)(d), pending.delete(d.id);
    if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise((r) => ((pending.set(++id, r), ws.send(JSON.stringify({ id, method, params })))));
  const val = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const shot = async (name) => {
    if (!shots) return;
    const r = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(shots, `${name}-${w}.png`), Buffer.from(r.result.data, "base64"));
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${base}/#/` });
  await sleep(5000);

  const rect = `(sel)=>{const e=document.querySelector(sel);if(!e)return null;const r=e.getBoundingClientRect();const cs=getComputedStyle(e);return {l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width,h:r.height,vis:cs.visibility,disp:cs.display}}`;
  const R = (sel) => val(`(${rect})(${JSON.stringify(sel)})`);
  const noHScroll = async (label) => {
    const sw = await val("document.documentElement.scrollWidth");
    const iw = await val("innerWidth");
    check(`${w}: no horizontal scroll (${label})`, sw <= iw, `scrollWidth ${sw} / innerWidth ${iw}`);
  };
  const onScreenX = (r) => r && r.w > 0 && r.h > 0 && r.l >= -0.5 && r.r <= w + 0.5;

  await noHScroll("home");
  await val("document.querySelector('[data-nav=projects]').click()");
  await sleep(3500);

  // records mode
  const head = await R("#shelf-title");
  const label = await R(".shelf-label");
  const toggle = await R(".mode-toggle");
  check(`${w}: records: Projects heading fully on screen`, onScreenX(head), JSON.stringify([head?.l | 0, head?.r | 0]));
  check(`${w}: records: "Pick a record" label has a rect and is visible`, onScreenX(label) && label.vis === "visible", JSON.stringify(label));
  check(`${w}: records: Records / List toggle has a rect and is visible`, onScreenX(toggle) && toggle.vis === "visible", JSON.stringify(toggle));
  await noHScroll("records");
  await shot("records");

  // list mode
  await val("document.querySelector('[data-mode=list]').click()");
  await sleep(2000);
  check(`${w}: list: label and toggle visible`, onScreenX(await R(".shelf-label")) && onScreenX(await R(".mode-toggle")));
  check(`${w}: list: rows shown`, (await val("document.querySelectorAll('.row-head').length")) === 4 && (await R(".row-head")).w > 0);
  await noHScroll("list");
  await shot("list");
  await val("document.querySelector('[data-mode=records]').click()");
  await sleep(3000);

  // open record
  await val("document.querySelectorAll('.track')[0].click()");
  await sleep(6500);
  const state = await val("document.getElementById('shelf').dataset.state");
  check(`${w}: record opens (state)`, state === "playing", state);
  const panel = await R(".panel:not([hidden])");
  check(`${w}: open: info panel visible with a rect inside the viewport`, onScreenX(panel) && panel.vis === "visible", JSON.stringify(panel));
  const title = await R(".panel:not([hidden]) .panel-title");
  check(`${w}: open: panel title visible`, onScreenX(title), JSON.stringify(title));
  if (w >= 768) {
    const frame = await R("#demo-frame");
    check(`${w}: open: demo frame inside the viewport`, onScreenX(frame) && frame.disp !== "none", JSON.stringify(frame));
    check(`${w}: open: frame top aligned with the panel top (+-24px)`, Math.abs(frame.t - panel.t) <= 24, `frame ${frame.t | 0} / panel ${panel.t | 0}`);
    const hidden = await val("[document.querySelector('.section-head'),document.querySelector('.shelf-label'),document.querySelector('.mode-toggle')].map((e)=>getComputedStyle(e).visibility).join()");
    check(`${w}: open: heading, label and toggle hidden`, hidden === "hidden,hidden,hidden", hidden);
  }
  await noHScroll("open record");
  await shot("open");
  await val("document.getElementById('eject').click()");
  await sleep(3500);
  const after = await R(".mode-toggle");
  check(`${w}: closed again: toggle visible`, onScreenX(after) && after.vis === "visible");

  // About / Contact
  for (const name of ["about", "contact"]) {
    await val(`document.querySelector('[data-nav=${name}]').click()`);
    await sleep(3500);
    const t = await R(`#${name}-title`);
    check(`${w}: ${name}: title fully on screen`, onScreenX(t) && t.t >= 40, JSON.stringify([t?.l | 0, t?.r | 0, t?.t | 0]));
    await noHScroll(name);
  }
  check(`${w}: no page errors`, errors.length === 0, errors[0] ?? "");
  ws.close();
  proc.kill();
}

for (const size of sizes) await run(size);
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
