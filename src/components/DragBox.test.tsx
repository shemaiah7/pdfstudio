// src/components/DragBox.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDragBox } from "./DragBox";

describe("useDragBox", () => {
  const toPage = (cx: number, cy: number) => ({ x: cx, y: 800 - cy });
  it("reports a click for movement under 3 px and a box otherwise", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() => useDragBox(onSelect, toPage));
    const ev = (clientX: number, clientY: number) => ({ clientX, clientY, button: 0, preventDefault() {}, currentTarget: { setPointerCapture() {}, releasePointerCapture() {} }, pointerId: 1 }) as unknown as React.PointerEvent<HTMLElement>;
    act(() => { result.current.handlers.onPointerDown(ev(10, 10)); result.current.handlers.onPointerUp(ev(11, 12)); });
    expect(onSelect).toHaveBeenLastCalledWith(null, { x: 10, y: 790 });
    act(() => { result.current.handlers.onPointerDown(ev(10, 10)); result.current.handlers.onPointerMove(ev(60, 40)); });
    expect(result.current.box).toEqual({ x: 10, y: 760, width: 50, height: 30 });
    act(() => { result.current.handlers.onPointerUp(ev(60, 40)); });
    expect(onSelect).toHaveBeenLastCalledWith({ x: 10, y: 760, width: 50, height: 30 }, { x: 10, y: 790 });
    expect(result.current.box).toBeNull();
  });
});
