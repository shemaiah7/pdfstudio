// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { Profiler } from "react";
import { render, act, cleanup } from "@testing-library/react";
import { BlockHint, sameBox } from "./PageView";
import type { Box } from "../pdf/types";

afterEach(cleanup);
describe("sameBox", () => {
  it("compares geometry, not identity", () => {
    const box = { x: 1, y: 2, width: 3, height: 4 };
    expect(sameBox(box, { ...box })).toBe(true);
    expect(sameBox(box, { ...box, height: 5 })).toBe(false);
    expect(sameBox(box, null)).toBe(false);
    expect(sameBox(null, null)).toBe(true);
  });
});
describe("BlockHint", () => {
  it("updates only its own page's outline", () => {
    const setters = new Map<string, (b: Box | null) => void>();
    const register = (id: string, set: ((b: Box | null) => void) | null) => { if (set) setters.set(id, set); else setters.delete(id); };
    const commits: Record<string, number> = { a: 0, b: 0 };
    const { container } = render(
      <>
        {["a", "b"].map((id) => <Profiler key={id} id={id} onRender={() => { commits[id]++; }}><BlockHint pageId={id} scale={2} heightPt={100} register={register} /></Profiler>)}
      </>,
    );
    const base = { a: commits.a, b: commits.b };
    const box = { x: 1, y: 2, width: 3, height: 4 };
    act(() => setters.get("a")!(box));
    expect(commits.a).toBe(base.a + 1);
    expect(commits.b).toBe(base.b);
    const outline = container.querySelector<HTMLElement>(".block-hint-outline")!;
    expect(outline.style.left).toBe("2px");
    expect(outline.style.top).toBe("188px"); // (100 - 2 - 4) * 2
    act(() => setters.get("a")!({ ...box, x: 9 }));
    expect(container.querySelector<HTMLElement>(".block-hint-outline")!.style.left).toBe("18px");
    expect(commits.b).toBe(base.b);
    act(() => setters.get("a")!(null));
    expect(container.querySelector(".block-hint-outline")).toBeNull();
  });
});
