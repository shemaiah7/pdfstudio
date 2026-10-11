export type SourceId = string;
export type Rotation = 0 | 90 | 180 | 270;
export interface SourceFile { id: SourceId; name: string; bytes: Uint8Array; pageCount: number; }
export interface PageEntry { id: string; sourceId: SourceId; sourcePageIndex: number; rotation: Rotation; }
export interface Box { x: number; y: number; width: number; height: number }
export type EditFont = "sans" | "sans-bold" | "serif";
export interface Edit { id: string; pageEntryId: string; boxes: Box[]; text: string; fontSize: number; font: EditFont; color: [number, number, number] }
