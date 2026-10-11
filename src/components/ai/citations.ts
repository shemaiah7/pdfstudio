export type Token = { type: "text"; value: string } | { type: "page"; page: number };

export function splitCitations(text: string): Token[] {
  const out: Token[] = [];
  const re = /\(p\.\s*(\d+)(?:\s*[-–]\s*\d+)?\)/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: "text", value: text.slice(last, m.index) });
    out.push({ type: "page", page: Number(m[1]) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out.length ? out : [{ type: "text", value: text }];
}
