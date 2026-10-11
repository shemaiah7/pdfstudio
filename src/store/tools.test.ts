import { describe, it, expect, beforeEach } from "vitest";
import { useToolsStore, COLORS } from "./tools";
const s = () => useToolsStore.getState();
beforeEach(() => { useToolsStore.setState({ color: COLORS[1].rgb, width: 2.5 }); s().setTool("select"); });
describe("tools store", () => {
  it("defaults", () => { expect(s().tool).toBe("select"); expect(s().color).toEqual(COLORS[1].rgb); expect(s().width).toBe(2.5); });
  it("highlight defaults to yellow and back", () => {
    s().setTool("highlight"); expect(s().color).toEqual(COLORS[4].rgb);
    s().setTool("ink"); expect(s().color).toEqual(COLORS[1].rgb);
  });
  it("keeps an explicit colour", () => {
    s().setColor(COLORS[2].rgb); s().setTool("highlight"); expect(s().color).toEqual(COLORS[2].rgb);
  });
});
