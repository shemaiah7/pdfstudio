/** True when the app was built with a Clerk key; without one there is no ClerkProvider and Clerk hooks must not render. */
export const clerkEnabled = (): boolean => {
  const key = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
  return typeof key === "string" && key.length > 0;
};
