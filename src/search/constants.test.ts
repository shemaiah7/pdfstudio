import { describe, expect, it } from "vitest";
import { cdnWasmPaths, ORT_VERSION } from "./constants";

describe("cdnWasmPaths", () => {
  it("points at the jsdelivr dist directory for the pinned version", () => {
    expect(cdnWasmPaths("1.2.3")).toBe("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.2.3/dist/");
    expect(cdnWasmPaths(ORT_VERSION)).toBe(`https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`);
  });
});
