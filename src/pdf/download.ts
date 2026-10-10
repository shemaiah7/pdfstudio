export function outputName(firstSourceName: string, kind: "edited" | "pages"): string {
  const base = firstSourceName.replace(/\.pdf$/i, "");
  return `${base}-${kind}.pdf`;
}

export function saveBlob(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
