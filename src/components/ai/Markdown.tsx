import { Fragment } from "react";
import { splitCitations } from "./citations";
import PageLink from "./PageLink";

function cites(text: string, key: string) {
  return splitCitations(text).map((t, i) =>
    t.type === "page" ? <PageLink key={`${key}-${i}`} page={t.page} /> : <span key={`${key}-${i}`}>{t.value}</span>,
  );
}

function inline(text: string, key: string) {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, j) =>
    /^\*\*[^*\n]+\*\*$/.test(part)
      ? <strong key={`${key}-${j}`}>{cites(part.slice(2, -2), `${key}-${j}`)}</strong>
      : <Fragment key={`${key}-${j}`}>{cites(part, `${key}-${j}`)}</Fragment>,
  );
}

const BULLET = /^\s*[-*]\s+/;
const NUMBER = /^\s*\d+[.)]\s+/;

function renderList(lines: string[], re: RegExp, key: string) {
  const items = lines.map((l, li) => <li key={li}>{inline(l.replace(re, ""), `${key}-${li}`)}</li>);
  return re === NUMBER ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
}

export default function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="md">
      {blocks.map((block, bi) => {
        const lines = block.split("\n");
        if (lines.every((l) => BULLET.test(l))) return renderList(lines, BULLET, `${bi}`);
        if (lines.every((l) => NUMBER.test(l))) return renderList(lines, NUMBER, `${bi}`);
        if (/^#{1,3}\s/.test(lines[0])) return <h4 key={bi}>{inline(lines[0].replace(/^#+\s/, ""), `${bi}`)}</h4>;
        // Non-list lead-in followed by a list: split at the first list line.
        const rest = lines.slice(1);
        for (const re of [BULLET, NUMBER]) {
          if (!re.test(lines[0]) && rest.length && rest.every((l) => re.test(l))) {
            return (
              <Fragment key={bi}>
                <p>{inline(lines[0], `${bi}-lead`)}</p>
                {renderList(rest, re, `${bi}-list`)}
              </Fragment>
            );
          }
        }
        return <p key={bi}>{inline(lines.join(" "), `${bi}`)}</p>;
      })}
    </div>
  );
}
