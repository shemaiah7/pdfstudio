// Regenerates the PNG icons from public/brand/*.svg using Playwright's Chromium.
// Run: npx tsx scripts/render-icons.ts
import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const BG = "#1b1b1a";
const mark = readFileSync(join(root, "public/brand/mark.svg"), "utf8");
const small = readFileSync(join(root, "public/brand/mark-small.svg"), "utf8");

// Inner artwork (everything after the tile rect) of mark.svg.
const art = mark.replace(/^[\s\S]*?<rect width="512" height="512" rx="112" fill="#1b1b1a"\/>/, "").replace("</svg>", "");

const svg = (size: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">${body}</svg>`;
const scaled = (k: number) => `<g transform="translate(256 256) scale(${k}) translate(-256 -256)">${art}</g>`;

const jobs: { out: string; size: number; svg: string }[] = [
  { out: "public/icons/favicon-32.png", size: 32, svg: small },
  { out: "public/icons/icon-192.png", size: 192, svg: mark },
  { out: "public/icons/icon-512.png", size: 512, svg: mark },
  { out: "public/icons/maskable-512.png", size: 512, svg: svg(512, `<rect width="512" height="512" fill="${BG}"/>${scaled(0.8)}`) },
  { out: "public/icons/apple-touch-icon.png", size: 180, svg: svg(180, `<rect width="512" height="512" fill="${BG}"/>${scaled(0.86)}`) },
  // macOS style: 824px rounded tile centred on a 1024 canvas.
  { out: "desktop/build/icon.png", size: 1024, svg: svg(1024, `<g transform="translate(100 100) scale(${824 / 512})">${mark.replace(/^<svg[^>]*>/, "").replace("</svg>", "")}</g>`).replace('viewBox="0 0 512 512"', 'viewBox="0 0 1024 1024"') },
];

mkdirSync(join(root, "public/icons"), { recursive: true });
const browser = await chromium.launch();
for (const j of jobs) {
  const page = await browser.newPage({ viewport: { width: j.size, height: j.size } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${j.size}px;height:${j.size}px}</style>${j.svg}`);
  await page.screenshot({ path: join(root, j.out), omitBackground: true, clip: { x: 0, y: 0, width: j.size, height: j.size } });
  await page.close();
  console.log("wrote", j.out);
}
await browser.close();
