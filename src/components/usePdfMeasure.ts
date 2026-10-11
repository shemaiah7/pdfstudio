import { useEffect, useState } from "react";
import { measureFor } from "../pdf/metrics";
import type { Measure } from "../pdf/layout";
import type { EditFont } from "../pdf/types";

/** pdf-lib measurers (same metrics as export), loaded lazily; entries are absent until ready. */
export function usePdfMeasure(fonts: EditFont[]): Partial<Record<EditFont, Measure>> {
  const [ready, setReady] = useState<Partial<Record<EditFont, Measure>>>({});
  const key = [...new Set(fonts)].sort().join(",");
  useEffect(() => {
    let cancelled = false;
    for (const f of key ? (key.split(",") as EditFont[]) : []) {
      void measureFor(f).then((m) => { if (!cancelled) setReady((r) => (r[f] ? r : { ...r, [f]: m })); });
    }
    return () => { cancelled = true; };
  }, [key]);
  return ready;
}
