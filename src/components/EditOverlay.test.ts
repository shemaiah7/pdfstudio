import { describe, it, expect } from "vitest";
import { overlayTransform } from "./EditOverlay";

describe("overlayTransform", () => {
  it("maps each rotation", () => {
    expect(overlayTransform(0, 300, 400)).toBe("none");
    expect(overlayTransform(90, 300, 400)).toBe("translate(400px,0) rotate(90deg)");
    expect(overlayTransform(180, 300, 400)).toBe("translate(300px,400px) rotate(180deg)");
    expect(overlayTransform(270, 300, 400)).toBe("translate(0,300px) rotate(270deg)");
  });
});
