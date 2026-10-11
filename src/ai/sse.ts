export interface SseEvent { event: string; data: string }

export function createSseParser(onEvent: (e: SseEvent) => void) {
  let buffer = "";
  const flush = (block: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (data.length) onEvent({ event, data: data.join("\n") });
  };
  return {
    push(chunk: string) {
      buffer += chunk.replace(/\r\n/g, "\n");
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        flush(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 2);
      }
    },
    end() {
      if (buffer.trim()) flush(buffer);
      buffer = "";
    },
  };
}
