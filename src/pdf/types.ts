export type SourceId = string;
export type Rotation = 0 | 90 | 180 | 270;
export interface SourceFile { id: SourceId; name: string; bytes: Uint8Array; pageCount: number; hash?: string }
export interface PageEntry { id: string; sourceId: SourceId; sourcePageIndex: number; rotation: Rotation; }
export interface Box { x: number; y: number; width: number; height: number }
export type EditFont = "sans" | "sans-bold" | "serif";
export interface Edit { id: string; pageEntryId: string; boxes: Box[]; text: string; fontSize: number; font: EditFont; color: [number, number, number] }
export type RGB = [number, number, number];
export interface AnnotationBase { id: string; pageEntryId: string; color: RGB }
export interface HighlightAnn extends AnnotationBase { kind: "highlight"; boxes: Box[] }
export interface NoteAnn extends AnnotationBase { kind: "note"; x: number; y: number; text: string }
export interface InkAnn extends AnnotationBase { kind: "ink"; strokes: { x: number; y: number }[][]; width: number }
export interface ShapeAnn extends AnnotationBase { kind: "shape"; shape: "rect" | "arrow"; x1: number; y1: number; x2: number; y2: number; width: number }
export interface FreeTextAnn extends AnnotationBase { kind: "freetext"; box: Box; text: string; fontSize: number }
export interface SignatureAnn extends AnnotationBase { kind: "signature"; box: Box; png: string }
export type Annotation = HighlightAnn | NoteAnn | InkAnn | ShapeAnn | FreeTextAnn | SignatureAnn;
export type FormValue = string | boolean | string[];
export type FormValues = Map<SourceId, Map<string, FormValue>>;
export type NewAnnotation = Annotation extends infer A ? (A extends unknown ? Omit<A, "id"> : never) : never;
export type AnnotationPatch = Annotation extends infer A ? (A extends unknown ? Partial<Omit<A, "id" | "kind" | "pageEntryId">> : never) : never;
