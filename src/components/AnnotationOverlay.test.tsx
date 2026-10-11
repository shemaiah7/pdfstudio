// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import AnnotationOverlay from "./AnnotationOverlay";
import type { Annotation } from "../pdf/types";

const c: [number, number, number] = [1, 0, 0];
describe("AnnotationOverlay", () => {
  it("renders a rect for a highlight and a path for ink", () => {
    const annotations: Annotation[] = [
      { id: "h", kind: "highlight", pageEntryId: "p", color: c, boxes: [{ x: 1, y: 1, width: 10, height: 5 }] },
      { id: "i", kind: "ink", pageEntryId: "p", color: c, width: 2, strokes: [[{ x: 0, y: 0 }, { x: 5, y: 5 }]] },
    ];
    const { container } = render(<AnnotationOverlay pageEntryId="p" annotations={annotations} meta={{ widthPt: 100, heightPt: 100, scale: 1, rotation: 0 }} pageEl={() => null} />);
    expect(container.querySelectorAll('[data-annotation-id="h"] rect')).toHaveLength(1);
    expect(container.querySelectorAll('[data-annotation-id="i"] path').length).toBeGreaterThanOrEqual(1);
  });
});

import { fireEvent } from "@testing-library/react";
import { useToolsStore } from "../store/tools";
import { useDocumentStore } from "../store/document";
function Live({ el }: { el: HTMLElement }) {
  const annotations = useDocumentStore((st) => st.annotations);
  return <AnnotationOverlay pageEntryId="p" annotations={annotations} meta={{ widthPt: 100, heightPt: 100, scale: 1, rotation: 0 }} pageEl={() => el} />;
}
describe("AnnotationOverlay drawing tools", () => {
  it("switches back to Select after a note commit and opens its popover", async () => {
    useToolsStore.getState().setTool("note");
    const el = document.createElement("div");
    const { container } = render(<Live el={el} />);
    const wrap = container.querySelector(".annotationOverlay")!;
    fireEvent.pointerDown(wrap, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(wrap, { pointerId: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(useToolsStore.getState().tool).toBe("select");
    expect(useDocumentStore.getState().annotations.some((a) => a.kind === "note")).toBe(true);
    expect(container.querySelector(".notePopover")).not.toBeNull();
  });
});
