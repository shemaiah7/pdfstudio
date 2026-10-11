import { splitCitations } from "./citations";
import PageLink from "./PageLink";

function inline(text: string, key: string) {
  return splitCitations(text).map((t, i) =>
    t.type === "page" ? <PageLink key={`${key}-${i}`} page={t.page} /> :
    t.value.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
      part.startsWith("**") ? <strong key={`${key}-${i}-${j}`}>{part.slice(2, -2)}</strong> : <span key={`${key}-${i}-${j}`}>{part}</span>),
  );
}

export default function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="md">
      {blocks.map((block, bi) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
          return <ul key={bi}>{lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*[-*]\s+/, ""), `${bi}-${li}`)}</li>)}</ul>;
        }
        if (/^#{1,3}\s/.test(lines[0])) return <h4 key={bi}>{inline(lines[0].replace(/^#+\s/, ""), `${bi}`)}</h4>;
        return <p key={bi}>{inline(lines.join(" "), `${bi}`)}</p>;
      })}
    </div>
  );
}
