/** Entry id of the page being viewed: the one under the vertical centre of the scroll container, else the most visible one. */
export function currentPageId(): string | null {
  if (typeof document === "undefined") return null;
  const root = document.querySelector(".pageview");
  if (!root) return null;
  const view = root.getBoundingClientRect();
  const mid = view.top + view.height / 2;
  let best: string | null = null, bestVisible = 0;
  for (const el of root.querySelectorAll<HTMLElement>('[id^="page-"]')) {
    const box = el.getBoundingClientRect();
    const id = el.id.slice("page-".length);
    if (box.top <= mid && mid <= box.bottom) return id;
    const visible = Math.min(box.bottom, view.bottom) - Math.max(box.top, view.top);
    if (visible > bestVisible) { bestVisible = visible; best = id; }
  }
  return best;
}
