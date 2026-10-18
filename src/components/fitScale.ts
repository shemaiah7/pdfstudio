/** Scale at which a page `widthPt` points wide fills `areaWidth` CSS px of the .pageview, minus its padding and a little slack. Clamped to the toolbar's zoom range. */
export function fitWidthScale(areaWidth: number, widthPt: number, gutter = 48): number | null {
  if (!(widthPt > 0) || !(areaWidth > 0)) return null;
  return Math.round(Math.min(3, Math.max(0.4, (areaWidth - gutter) / widthPt)) * 100) / 100;
}
