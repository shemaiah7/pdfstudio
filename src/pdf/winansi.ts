// Standard fonts only encode WinAnsi; replace anything else so measuring and export never throw.
export const toWinAnsi = (t: string) => t.replace(/[^\x20-\x7E -ÿ]/g, "?");
