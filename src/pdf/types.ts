export type SourceId = string;
export type Rotation = 0 | 90 | 180 | 270;
export interface SourceFile { id: SourceId; name: string; bytes: Uint8Array; pageCount: number; }
export interface PageEntry { id: string; sourceId: SourceId; sourcePageIndex: number; rotation: Rotation; }
