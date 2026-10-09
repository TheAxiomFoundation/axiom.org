import type { ReactNode } from "react";

/**
 * Just enough Markdown for chatbot answers: paragraphs, headings,
 * bulleted and numbered lists, simple tables, **bold** and links. Built
 * from React nodes, never HTML strings, so model output cannot inject
 * markup.
 */

export type Block =
  | { type: "p"; text: string }
  | { type: "h"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "table"; rows: string[][] };

const BULLET_RE = /^\s*[-*•]\s+(.*)$/;
const NUMBERED_RE = /^\s*\d+[.)]\s+(.*)$/;
const HEADING_RE = /^\s*#{1,6}\s+(.*)$/;
const TABLE_RE = /^\s*\|.*\|\s*$/;
const TABLE_RULE_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "p", text: paragraph.join(" ") });
    paragraph = [];
  };
  const tail = () => blocks[blocks.length - 1];
  for (const line of source.replace(/\r\n/g, "\n").split("\n")) {
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = line.match(HEADING_RE);
    const bullet = line.match(BULLET_RE);
    const numbered = line.match(NUMBERED_RE);
    if (TABLE_RE.test(line)) {
      flush();
      if (TABLE_RULE_RE.test(line)) continue;
      const last = tail();
      if (last?.type === "table") last.rows.push(tableCells(line));
      else blocks.push({ type: "table", rows: [tableCells(line)] });
    } else if (heading) {
      flush();
      blocks.push({ type: "h", text: heading[1] });
    } else if (bullet) {
      flush();
      const last = tail();
      if (last?.type === "ul") last.items.push(bullet[1]);
      else blocks.push({ type: "ul", items: [bullet[1]] });
    } else if (numbered) {
      flush();
      const last = tail();
      if (last?.type === "ol") last.items.push(numbered[1]);
      else blocks.push({ type: "ol", items: [numbered[1]] });
    } else if (!paragraph.length && /^\s{2,}/.test(line) && (tail()?.type === "ul" || tail()?.type === "ol")) {
      // An indented continuation of the previous list item.
      const list = tail() as { items: string[] };
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();
  return blocks;
}

const INLINE_RE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+)/g;

export function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE_RE)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const key = `${keyPrefix}-${index++}`;
    if (match[1]) {
      nodes.push(<strong key={key}>{match[1]}</strong>);
    } else {
      const href = match[3] ?? match[4];
      const label = match[2] ?? href.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
      nodes.push(
        <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="aspen-link break-words">
          {label}
        </a>,
      );
    }
    last = start + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function AnswerText({ text, className }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className={className ?? "flex flex-col gap-3"}>
      {blocks.map((block, b) => {
        const key = `b${b}`;
        if (block.type === "h") {
          return (
            <p key={key} className="m-0 font-semibold">
              {renderInline(block.text, key)}
            </p>
          );
        }
        if (block.type === "ul" || block.type === "ol") {
          const List = block.type;
          return (
            <List key={key} className={`m-0 flex flex-col gap-1 pl-5 ${block.type === "ul" ? "list-disc" : "list-decimal"}`}>
              {block.items.map((item, i) => (
                <li key={`${key}-${i}`}>{renderInline(item, `${key}-${i}`)}</li>
              ))}
            </List>
          );
        }
        if (block.type === "table") {
          const [head, ...body] = block.rows;
          return (
            <div key={key} className="overflow-x-auto">
              <table className="w-full border-collapse text-[0.85em]">
                <thead>
                  <tr>
                    {head.map((cell, c) => (
                      <th key={c} className="border-b border-[var(--color-rule)] px-2 py-1 text-left font-semibold">
                        {renderInline(cell, `${key}-h${c}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, c) => (
                        <td key={c} className="border-b border-[var(--color-rule-subtle)] px-2 py-1 align-top">
                          {renderInline(cell, `${key}-${r}-${c}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return (
          <p key={key} className="m-0">
            {renderInline(block.text, key)}
          </p>
        );
      })}
    </div>
  );
}
