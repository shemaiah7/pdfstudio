/** Quiet Desk look for Clerk's sign-in modal. Clerk accepts CSS values (including var()) for these variables. */
export const clerkAppearance = {
  variables: {
    colorPrimary: "var(--color-ink)",
    colorText: "var(--color-ink)",
    colorTextSecondary: "var(--color-ink-2)",
    colorBackground: "var(--color-surface)",
    colorInputBackground: "var(--color-surface)",
    colorInputText: "var(--color-ink)",
    borderRadius: "11px",
    fontFamily: "var(--font-sans)",
  },
  elements: {
    card: { boxShadow: "var(--shadow-3)" },
    formButtonPrimary: { color: "var(--color-on-primary)" },
    // Clerk derives these from its "neutral" colour, which defaults to black and can't be set from a CSS var,
    // so the Google button text and outlines were black-on-dark in dark mode. Style them from our tokens directly.
    socialButtonsBlockButton: { color: "var(--color-ink)", boxShadow: "0 0 0 1px var(--color-line) !important" },
    socialButtonsBlockButtonText: { color: "var(--color-ink)" },
    formFieldInput: { boxShadow: "0 0 0 1px var(--color-line) !important" },
    dividerLine: { backgroundColor: "var(--color-line)" },
  },
};
