export interface OcrBox { x: number; y: number; width: number; height: number }
export interface OcrWord { text: string; box: OcrBox; confidence: number }
export interface OcrLine { text: string; box: OcrBox; words: OcrWord[] }
export type OcrEngineName = "tesseract" | "claude";
export interface OcrPage { engine: OcrEngineName; lines: OcrLine[]; confidence: number; at: number }
export interface PageMetaPt { widthPt: number; heightPt: number }
export interface OcrEngine { recognize(canvas: HTMLCanvasElement, meta: PageMetaPt, signal?: AbortSignal): Promise<OcrPage> }
