import { it, expect } from "vitest";
import { clerkAppearance } from "./clerkAppearance";

it("maps Clerk variables to Quiet Desk tokens", () => {
  expect(Object.keys(clerkAppearance.variables).sort()).toEqual(["borderRadius", "colorBackground", "colorInputBackground", "colorInputText", "colorPrimary", "colorText", "colorTextSecondary", "fontFamily"]);
  expect(clerkAppearance.variables.colorPrimary).toBe("var(--color-ink)");
  expect(clerkAppearance.elements.card).toBeTruthy();
});

it("styles the Google button, inputs and divider from tokens (dark-mode contrast)", () => {
  const e = clerkAppearance.elements as Record<string, Record<string, string>>;
  expect(e.socialButtonsBlockButtonText.color).toBe("var(--color-ink)");
  expect(e.socialButtonsBlockButton.color).toBe("var(--color-ink)");
  expect(e.socialButtonsBlockButton.boxShadow).toContain("var(--color-line)");
  expect(e.formFieldInput.boxShadow).toContain("var(--color-line)");
  expect(e.dividerLine.backgroundColor).toBe("var(--color-line)");
});
