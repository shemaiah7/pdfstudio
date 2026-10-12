import type { Box, Edit, PageEntry, RGB, Run, SourceFile } from "../pdf/types";
import type { TextLine } from "./blocks";
import { fontInfoFor } from "./fontInfo";
import { matchFont } from "./fontMatch";

export type PdfPageLike = { commonObjs: { has(id: string): boolean; get(id: string): unknown } };
export type Styles = Record<string, { fontFamily?: string }>;
export interface OpenLine { line: TextLine; runs: Run[]; existing?: Edit; background: RGB }
export interface OpenLines { entry: PageEntry; source: SourceFile; box: Box; lines: OpenLine[]; background: RGB }

/** One styled run per detected run: face from the source font's name and flags, size from the items, colour from `colorFor` (default `color`). */
export function runsFor(line: TextLine, page: PdfPageLike, styles: Styles, color: RGB, colorFor?: (run: TextLine["runs"][number]) => RGB): Run[] {
  return line.runs.map((r) => ({ text: r.text, font: matchFont(fontInfoFor(page, r.fontName, styles)), fontSize: r.fontSize, color: colorFor ? colorFor(r) : color }));
}

export function runsFromEdit(edit: Edit): Run[] {
  if (edit.kind === "line") return (edit.runs ?? []).map((r) => ({ ...r }));
  return [{ text: edit.text, font: edit.font, fontSize: edit.fontSize, color: edit.color }];
}

export const runsText = (runs: Run[]): string => runs.map((r) => r.text).join("");

export function sameRuns(a: Run[], b: Run[]): boolean {
  return a.length === b.length && a.every((r, i) => r.text === b[i].text && r.font === b[i].font && Math.abs(r.fontSize - b[i].fontSize) < 1e-6);
}
