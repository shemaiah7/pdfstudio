import { it, expect } from "vitest";
import { clerkAppearance } from "./clerkAppearance";

it("maps Clerk variables to Quiet Desk tokens", () => {
  expect(Object.keys(clerkAppearance.variables).sort()).toEqual(["borderRadius", "colorBackground", "colorInputBackground", "colorInputText", "colorPrimary", "colorText", "colorTextSecondary", "fontFamily"]);
  expect(clerkAppearance.variables.colorPrimary).toBe("var(--color-ink)");
  expect(clerkAppearance.elements.card).toBeTruthy();
});
