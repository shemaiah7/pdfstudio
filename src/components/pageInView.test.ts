// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { currentPageId } from "./pageInView";

const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top, toJSON() {} }) as DOMRect;
function mount(root: [number, number], pages: Record<string, [number, number]>) {
  document.body.innerHTML = `<main class="pageview">${Object.keys(pages).map((id) => `<div id="page-${id}"></div>`).join("")}</main>`;
  document.querySelector(".pageview")!.getBoundingClientRect = () => rect(...root);
  for (const [id, r] of Object.entries(pages)) document.getElementById(`page-${id}`)!.getBoundingClientRect = () => rect(...r);
}
afterEach(() => { document.body.innerHTML = ""; });

describe("currentPageId", () => {
  it("returns the page whose box contains the vertical centre of the scroll container", () => {
    mount([100, 500], { a: [-300, 90], b: [100, 290], c: [290, 700], d: [700, 1100] });
    expect(currentPageId()).toBe("c");
  });
  it("falls back to the page with the largest visible height when the centre sits in a gap", () => {
    mount([100, 500], { a: [-200, 250], b: [350, 380], c: [380, 410] });
    // centre 300 is in the gap 250..350; a shows 150px, b 30px, c 30px
    expect(currentPageId()).toBe("a");
  });
  it("returns null with no pages, no container or no DOM", () => {
    document.body.innerHTML = "";
    expect(currentPageId()).toBeNull();
    mount([0, 100], {});
    expect(currentPageId()).toBeNull();
  });
  it("returns null when nothing is visible", () => {
    mount([100, 500], { a: [-300, -100] });
    expect(currentPageId()).toBeNull();
  });
});
