// Regenerates the browser-extension store screenshots in extension/store/ (1280x800 JPEG).
// Usage: npm run extension:screenshots
// Loads the dev build of the extension (scripts/extension-dev.sh) in a throwaway Chromium profile, the same
// way e2e/extension.spec.ts does, so it needs the app on http://localhost:5199 (started here if not running).
import { chromium } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

const APP = "http://localhost:5199";
const EXT_DIR = resolve("extension/dist/dev");
const OUT_DIR = resolve("extension/store");
const SHOT_1 = join(OUT_DIR, "1-opened-in-sentinelpdf.jpg");
const SHOT_2 = join(OUT_DIR, "2-toolbar-popup.jpg");
const VIEWPORT = { width: 1280, height: 800 };

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function answers(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

/** A two-page Letter document that reads like a real lease, built from HTML so no fixture or font file is needed. */
const LEASE_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: Letter; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #1d1d1b; font: 12.5px/1.55 Georgia, "Times New Roman", serif; }
  .page { width: 8.5in; height: 11in; padding: 0.9in 0.95in; page-break-after: always; position: relative; overflow: hidden; }
  .page:last-child { page-break-after: auto; }
  .brand { font: 700 11px/1 -apple-system, "Helvetica Neue", Arial, sans-serif; letter-spacing: 0.14em; text-transform: uppercase; color: #3346d3; }
  h1 { margin: 10px 0 4px; font-size: 27px; letter-spacing: 0.01em; }
  .sub { margin: 0 0 22px; color: #6b6963; font-size: 12px; padding-bottom: 14px; border-bottom: 2px solid #1d1d1b; }
  h2 { margin: 20px 0 6px; font: 700 12px/1.3 -apple-system, "Helvetica Neue", Arial, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: #3346d3; }
  p { margin: 0 0 9px; text-align: justify; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0 14px; font: 12px/1.4 -apple-system, "Helvetica Neue", Arial, sans-serif; }
  th { text-align: left; background: #eef0fb; padding: 7px 10px; border: 1px solid #cfd3ee; }
  td { padding: 7px 10px; border: 1px solid #dcdad4; }
  td.r, th.r { text-align: right; }
  tr.total td { font-weight: 700; background: #f6f5f1; }
  .sig { display: flex; gap: 48px; margin-top: 56px; }
  .sig div { flex: 1; border-top: 1px solid #1d1d1b; padding-top: 6px; font: 11px/1.4 -apple-system, "Helvetica Neue", Arial, sans-serif; color: #55534e; }
  .foot { position: absolute; left: 0.95in; right: 0.95in; bottom: 0.55in; display: flex; justify-content: space-between; font: 10px/1 -apple-system, "Helvetica Neue", Arial, sans-serif; color: #8a877f; }
</style></head><body>
<div class="page">
  <div class="brand">Harborview Property Management</div>
  <h1>Residential Lease Agreement</h1>
  <p class="sub">Unit 4B, 218 Alder Street, Paterson, NJ 07501 &nbsp;&middot;&nbsp; Lease no. HV-2026-0418</p>
  <h2>1. Parties</h2>
  <p>This Lease Agreement is made on November 1, 2026 between Harborview Property Management, LLC (&ldquo;Landlord&rdquo;) and Jordan A. Whitfield (&ldquo;Tenant&rdquo;). The Landlord leases to the Tenant, and the Tenant leases from the Landlord, the residential premises described above (the &ldquo;Premises&rdquo;) for use as a private dwelling only.</p>
  <h2>2. Term</h2>
  <p>The term of this Lease is twelve (12) months, beginning on December 1, 2026 and ending on November 30, 2027. Unless either party gives written notice at least sixty (60) days before the end of the term, this Lease continues on a month-to-month basis on the same conditions.</p>
  <h2>3. Rent and charges</h2>
  <p>The Tenant agrees to pay rent in advance on or before the first day of each month. Rent that is more than five (5) days late is subject to a late fee, and a returned payment is subject to the bank charge shown below.</p>
  <table>
    <tr><th>Item</th><th>Due</th><th class="r">Amount</th></tr>
    <tr><td>Monthly rent</td><td>1st of each month</td><td class="r">$1,850.00</td></tr>
    <tr><td>Security deposit</td><td>At signing</td><td class="r">$1,850.00</td></tr>
    <tr><td>Parking space (optional)</td><td>1st of each month</td><td class="r">$75.00</td></tr>
    <tr><td>Late fee</td><td>After 5 days</td><td class="r">$50.00</td></tr>
    <tr class="total"><td colspan="2">Due at signing</td><td class="r">$3,700.00</td></tr>
  </table>
  <h2>4. Security deposit</h2>
  <p>The security deposit is held in an interest-bearing account at a New Jersey bank and is returned within thirty (30) days after the Tenant vacates, less any lawful deductions for unpaid rent or damage beyond ordinary wear and tear. The Tenant will receive an itemized statement of any deduction.</p>
  <h2>5. Utilities</h2>
  <p>The Tenant pays for electricity, gas and internet service. The Landlord pays for water, sewer and trash collection. The Tenant will place electricity and gas accounts in the Tenant&rsquo;s name before the start of the term.</p>
  <div class="foot"><span>Lease no. HV-2026-0418</span><span>Page 1 of 2</span></div>
</div>
<div class="page">
  <div class="brand">Harborview Property Management</div>
  <h2 style="margin-top:18px">6. Use and occupancy</h2>
  <p>The Premises may be occupied only by the Tenant and the persons named in this Lease. The Tenant will keep the Premises clean and in good condition, will not make alterations without the Landlord&rsquo;s written consent, and will not disturb the quiet enjoyment of neighbors.</p>
  <h2>7. Maintenance and repairs</h2>
  <p>The Tenant reports any needed repair to the Landlord promptly in writing. The Landlord will make repairs to the structure, plumbing, heating and electrical systems within a reasonable time after notice. The Tenant is responsible for damage caused by the Tenant or the Tenant&rsquo;s guests.</p>
  <h2>8. Entry by the Landlord</h2>
  <p>The Landlord may enter the Premises to inspect, repair or show the unit after giving at least twenty-four (24) hours&rsquo; notice, except in an emergency, when no notice is required.</p>
  <h2>9. Pets</h2>
  <p>No animals are permitted on the Premises without the Landlord&rsquo;s written consent, other than assistance animals as provided by law. Approved pets are subject to a separate pet addendum and a refundable deposit of $300.00.</p>
  <h2>10. Default and termination</h2>
  <p>If the Tenant fails to pay rent or breaks any other term of this Lease and does not correct it within the time allowed by law, the Landlord may end the tenancy and pursue the remedies available under New Jersey law.</p>
  <h2>11. Entire agreement</h2>
  <p>This Lease is the entire agreement between the parties. It may be changed only in a writing signed by both the Landlord and the Tenant.</p>
  <div class="sig"><div>Landlord signature &amp; date<br>Harborview Property Management, LLC</div><div>Tenant signature &amp; date<br>Jordan A. Whitfield</div></div>
  <div class="foot"><span>Lease no. HV-2026-0418</span><span>Page 2 of 2</span></div>
</div>
</body></html>`;

let vite;
let viteStarted = false;
let host;
let context;
let userDir;

async function cleanup() {
  try { await context?.close(); } catch {}
  try { host?.close(); } catch {}
  if (userDir) rmSync(userDir, { recursive: true, force: true });
  if (viteStarted && vite && vite.exitCode === null) {
    vite.kill("SIGTERM");
    await sleep(300);
    if (vite.exitCode === null) vite.kill("SIGKILL");
  }
}

async function main() {
  execFileSync("sh", ["scripts/extension-dev.sh"], { stdio: "pipe" });
  mkdirSync(OUT_DIR, { recursive: true });

  if (await answers(APP)) {
    console.log(`Reusing the app already running on ${APP}`);
  } else {
    console.log(`Starting vite on ${APP}`);
    vite = spawn("npx", ["vite", "--port", "5199", "--strictPort"], { stdio: "ignore" });
    viteStarted = true;
    const deadline = Date.now() + 60_000;
    while (!(await answers(APP))) {
      if (vite.exitCode !== null) throw new Error("vite exited before it started answering on 5199");
      if (Date.now() > deadline) throw new Error("vite did not answer on 5199 within 60 s");
      await sleep(500);
    }
  }

  userDir = mkdtempSync(join(tmpdir(), "sentinel-shots-"));
  // channel "chromium" is Playwright's new headless mode, the only one that loads extensions.
  context = await chromium.launchPersistentContext(userDir, {
    channel: "chromium",
    headless: true,
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
  });

  // The sample PDF, printed from HTML by the same browser.
  const maker = await context.newPage();
  await maker.setContent(LEASE_HTML);
  const pdf = await maker.pdf({ format: "Letter", printBackground: true });
  await maker.close();

  host = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (path === "/Lease-Agreement.pdf") { res.writeHead(200, { "Content-Type": "application/pdf" }); res.end(pdf); }
    else { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("nope"); }
  });
  await new Promise((ok) => host.listen(0, "127.0.0.1", ok));
  // 127.0.0.1, not "localhost": the redirect rule excludes the app host.
  const origin = `http://127.0.0.1:${host.address().port}`;

  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  await sw.evaluate((o) => chrome.storage.local.set({ appOrigin: o }), APP);
  const ruleDeadline = Date.now() + 15_000;
  for (;;) {
    const rules = await sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
    if (rules.length === 1 && rules[0].action.redirect?.regexSubstitution?.startsWith(`${APP}/#sx=`)) break;
    if (Date.now() > ruleDeadline) throw new Error("the redirect rule did not appear");
    await sleep(200);
  }

  // Shot 1: a PDF link opened through the extension.
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);
  await page.goto(`${origin}/Lease-Agreement.pdf`);
  await page.waitForURL(`${APP}/**`);
  await page.getByTestId("thumb").first().waitFor({ timeout: 30_000 });
  // The hand-off hash is removed once the document is open.
  const hashDeadline = Date.now() + 30_000;
  while (new URL(page.url()).hash !== "") {
    if (Date.now() > hashDeadline) throw new Error("the hand-off hash was never cleared; the document did not open");
    await sleep(200);
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: SHOT_1, type: "jpeg", quality: 92 });
  await page.close();
  if (statSync(SHOT_1).size < 40_000) throw new Error(`${SHOT_1} looks blank (${statSync(SHOT_1).size} bytes)`);

  // Shot 2: the popup, composed on a 1280x800 canvas.
  const id = new URL(sw.url()).host;
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 400 });
  // Opened as a tab of its own, the popup would see itself as the active page and disable its button. Report an
  // ordinary web page instead, which is what a user has in front of them when they open the popup.
  await popup.addInitScript(() => {
    const real = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = async (q, ...rest) => {
      if (q && q.active) {
        window.__tabQueried = true;
        return [{ id: 1, url: "https://example.com/reports/2026-lease-renewal.pdf", active: true, windowId: 1 }];
      }
      return real(q, ...rest);
    };
  });
  // Render at twice the pixel density so the popup stays crisp when the canvas shows it larger.
  const cdp = await popup.context().newCDPSession(popup);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 360, height: 400, deviceScaleFactor: 2, mobile: false });
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.locator("#auto").waitFor();
  await popup.waitForFunction(() => document.querySelector("#auto")?.checked === true, null, { timeout: 15_000 });
  // popup.js enables the button only after its tab query resolves, so wait for that, then for the final state.
  await popup.waitForFunction(() => window.__tabQueried === true, null, { timeout: 15_000 });
  await popup.waitForFunction(() => !document.querySelector("#open").disabled && document.querySelector("#hint").hidden, null, { timeout: 15_000 });
  await popup.waitForTimeout(200);
  const openEnabled = await popup.locator("#open").isEnabled();
  if (!openEnabled) throw new Error("the popup's open button is disabled; the screenshot would show the wrong state");
  console.log("popup: #open enabled =", openEnabled);
  const popupPng = await popup.locator("body").screenshot({ type: "png", scale: "device" });
  await popup.close();

  const canvas = await context.newPage();
  await canvas.setViewportSize(VIEWPORT);
  await canvas.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; width: 1280px; height: 800px; background: #f4f1ec; }
    body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 36px;
      font: 22px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #333; }
    img { display: block; border-radius: 8px; box-shadow: 0 10px 40px rgba(40, 36, 28, 0.22), 0 2px 8px rgba(40, 36, 28, 0.12); }
    p { margin: 0; }
  </style></head><body>
    <img alt="" width="420" src="data:image/png;base64,${popupPng.toString("base64")}">
    <p>Turn automatic opening on or off from the toolbar</p>
  </body></html>`);
  await canvas.screenshot({ path: SHOT_2, type: "jpeg", quality: 92 });
  await canvas.close();

  // Verify.
  for (const f of [SHOT_1, SHOT_2]) {
    const { width, height } = jpegSize(readFileSync(f));
    if (width !== VIEWPORT.width || height !== VIEWPORT.height) throw new Error(`${f} is ${width}x${height}, expected 1280x800`);
    console.log(`${f}  ${width}x${height}  ${statSync(f).size} bytes`);
    if (process.platform === "darwin") {
      console.log(execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", f], { encoding: "utf8" }).trim());
    }
  }
}

/** Reads the frame size from the first SOFn marker of a JPEG. */
function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error("not a JPEG");
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error("no frame header found in the JPEG");
}

let failed = false;
try {
  await main();
} catch (err) {
  failed = true;
  console.error(err);
} finally {
  await cleanup();
}
process.exit(failed ? 1 : 0);
