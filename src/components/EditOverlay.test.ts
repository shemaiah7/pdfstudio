// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { render } from "@testing-library/react";
import type { Edit } from "../pdf/types";
import EditOverlay, { overlayTransform } from "./EditOverlay";

describe("overlayTransform", () => {
  it("maps each rotation", () => {
    expect(overlayTransform(0, 300, 400)).toBe("none");
    expect(overlayTransform(90, 300, 400)).toBe("translate(400px,0) rotate(90deg)");
    expect(overlayTransform(180, 300, 400)).toBe("translate(300px,400px) rotate(180deg)");
    expect(overlayTransform(270, 300, 400)).toBe("translate(0,300px) rotate(270deg)");
  });
});

describe("EditOverlay line edits", () => {
  it("renders one text element per run with the run's face", () => {
    const edit: Edit = { id: "e", pageEntryId: "p", kind: "line", x: 20, baseline: 700, region: { x: 20, y: 697.5, width: 55, height: 12 }, boxes: [{ x: 20, y: 697.5, width: 55, height: 12 }], runs: [{ text: "Label ", font: "helvetica-bold", fontSize: 10, color: [0, 0, 0] }, { text: "value", font: "helvetica", fontSize: 10, color: [0, 0, 0] }], text: "Label value", fontSize: 10, font: "helvetica-bold", color: [0, 0, 0] };
    const { container } = render(createElement(EditOverlay, { edits: [edit], scale: 1, pageHeightPt: 800, pageWidthPt: 600, rotation: 0 }));
    const runs = [...container.querySelectorAll(".edit-line")] as HTMLElement[];
    expect(runs.map((r) => r.textContent)).toEqual(["Label ", "value"]);
    expect(runs[0].style.font).toMatch(/bold|700/); // FONT_CSS spells bold as weight 700
    expect(runs[1].style.font).not.toMatch(/bold|700/);
    expect(parseFloat(runs[1].style.left)).toBeGreaterThan(parseFloat(runs[0].style.left));
  });
});
