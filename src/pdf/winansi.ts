// Standard fonts only encode WinAnsi (Windows-1252); replace anything else so measuring and export never throw.
// Keep exactly the code points pdf-lib can encode, so the measured string equals the drawn string.
export const toWinAnsi = (t: string) =>
  t.replace(/[^\x20-\x7E -ÿŒœŠšŸŽžƒˆ˜–—‘’‚“”„†‡•…‰‹›€™]/g, "?");
