const PATHS = {
  "open": "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  "add-file": "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M12 11v6 M9 14h6",
  "undo": "M9 14L4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3",
  "redo": "M15 14l5-5-5-5 M20 9H10a6 6 0 0 0 0 12h3",
  "rotate-left": "M3 12a9 9 0 1 0 3-6.7 M3 4v5h5",
  "rotate-right": "M21 12a9 9 0 1 1-3-6.7 M21 4v5h-5",
  "delete": "M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3",
  "extract": "M8 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4 M14 3h7v7 M21 3l-9 9",
  "clear-form": "M4 6h16v12H4z M8 10h5 M8 14h3 M15 13l3 3 M18 13l-3 3",
  "deep-ocr": "M4 8V5a1 1 0 0 1 1-1h3 M16 4h3a1 1 0 0 1 1 1v3 M20 16v3a1 1 0 0 1-1 1h-3 M8 20H5a1 1 0 0 1-1-1v-3 M8 10h8 M8 14h5",
  "chevron-down": "M6 9l6 6 6-6",
  "download": "M12 4v11 M7 10l5 5 5-5 M4 20h16",
  "minus": "M5 12h14",
  "plus": "M12 5v14 M5 12h14",
  "file": "M7 3h7l5 5v13H7z M14 3v5h5 M10 13h6 M10 17h4",
  "select": "M5 3l14 8-6 2-3 6z",
  "edit": "M4 7V5h16v2 M12 5v14 M9 19h6",
  "highlight": "M15 4l5 5-9 9H6v-5z M4 21h16",
  "note": "M5 4h14v11l-5 5H5z M14 20v-5h5",
  "ink": "M4 20c4-1 5-6 8-6s3 4 8-2",
  "rect": "M4 6h16v12H4z",
  "arrow": "M5 19L19 5 M10 5h9v9",
  "freetext": "M4 4h16v16H4z M8 9h8 M12 9v7",
  "sign": "M3 17c3 0 4-8 6-8s0 8 3 8 3-4 5-4 2 2 4 2 M3 21h18",
  "mic": "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z M5 11a7 7 0 0 0 14 0 M12 18v3",
  "mic-off": "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z M5 11a7 7 0 0 0 14 0 M12 18v3 M4 4l16 16",
  "voice": "M4 10v4 M8 7v10 M12 4v16 M16 7v10 M20 10v4",
  "search": "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4",
  "lock": "M6 11h12v9H6z M8 11V8a4 4 0 0 1 8 0v3",
  "send": "M12 19V5 M6 11l6-6 6 6",
  "page": "M7 3h7l5 5v13H7z M14 3v5h5",
  "alert": "M12 8v5 M12 16.5v.5 M10.3 4l-7.6 13.2A2 2 0 0 0 4.4 20h15.2a2 2 0 0 0 1.7-2.8L13.7 4a2 2 0 0 0-3.4 0z",
  "close": "M6 6l12 12 M18 6L6 18",
  "grip": "M9 6h.01 M15 6h.01 M9 12h.01 M15 12h.01 M9 18h.01 M15 18h.01",
  "grid": "M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z",
  "dots": "M5 12h.01 M12 12h.01 M19 12h.01",
  "monitor": "M3 4h18v12H3z M8 20h8 M12 16v4",
  "install": "M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M16.5 13.5v6 M13.5 16.5h6",
  "sun": "M12 4V2 M12 22v-2 M4.9 4.9 3.5 3.5 M20.5 20.5l-1.4-1.4 M4 12H2 M22 12h-2 M4.9 19.1l-1.4 1.4 M20.5 3.5l-1.4 1.4 M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z",
  "moon": "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  "upload": "M12 16V4 M7 9l5-5 5 5 M4 20h16",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={name === "dots" ? 3 : 1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
