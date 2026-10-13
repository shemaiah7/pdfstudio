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
  },
};
