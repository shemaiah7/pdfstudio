import { useEffect, useState } from "react";
import type { SourceFile, SourceId } from "../pdf/types";
import { readFields, type FieldDef } from "../pdf/forms";
import { sourceReleasers } from "../store/document";

const loaded = new Map<SourceId, FieldDef[]>();
sourceReleasers.push((id) => loaded.delete(id));

export function useFields(source: SourceFile | undefined): FieldDef[] | null {
  const [, setTick] = useState(0);
  const id = source?.id;
  useEffect(() => {
    if (!source || loaded.has(source.id)) return;
    let live = true;
    readFields(source).then((f) => {
      if (!live) return;
      loaded.set(source.id, f);
      setTick((t) => t + 1);
    });
    return () => { live = false; };
  }, [source]);
  return id ? loaded.get(id) ?? null : null;
}
