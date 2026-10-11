import type { SyntheticEvent } from "react";
import { fieldsOnPage, type FieldDef } from "../pdf/forms";
import type { PageMeta } from "../pdf/geometry";
import type { FormValue } from "../pdf/types";
import { useDocumentStore } from "../store/document";
import { overlayTransform } from "./EditOverlay";

interface Props { sourceId: string; sourcePageIndex: number; fields: FieldDef[]; meta: PageMeta }

const stop = (e: SyntheticEvent) => e.stopPropagation();

export default function FormLayer({ sourceId, sourcePageIndex, fields, meta }: Props) {
  const values = useDocumentStore((s) => s.formValues.get(sourceId));
  const setFormValue = useDocumentStore((s) => s.setFormValue);
  const { scale, heightPt } = meta;
  const W = meta.widthPt * scale, H = heightPt * scale;
  const set = (name: string, v: FormValue) => setFormValue(sourceId, name, v);

  return (
    <div className="formLayer" onPointerDown={stop} onClick={stop} onKeyDown={stop}
      style={{ width: W, height: H, transform: overlayTransform(meta.rotation, W, H) }}>
      {fieldsOnPage(fields, sourcePageIndex).flatMap((f) =>
        f.widgets.map((w, i) => {
          if (w.pageIndex !== sourcePageIndex) return null;
          const r = w.rect;
          const style = { left: r.x * scale, top: (heightPt - r.y - r.height) * scale, width: r.width * scale, height: r.height * scale };
          const key = `${f.name}:${i}`;
          const v = values?.has(f.name) ? values.get(f.name) : f.value;
          switch (f.type) {
            case "text":
              return <input key={key} type="text" data-field={f.name} style={style} value={typeof v === "string" ? v : ""} onChange={(e) => set(f.name, e.target.value)} />;
            case "checkbox":
              return <input key={key} type="checkbox" data-field={f.name} style={style} checked={v === true} onChange={(e) => set(f.name, e.target.checked)} />;
            case "radio": {
              const opt = f.options?.[i] ?? "";
              return <input key={key} type="radio" name={f.name} value={opt} data-field={f.name} style={style} checked={v === opt} onChange={() => set(f.name, opt)} />;
            }
            case "dropdown":
              if (f.multiple) {
                return (
                  <select key={key} multiple data-field={f.name} style={style} value={Array.isArray(v) ? v : []}
                    onChange={(e) => set(f.name, Array.from(e.target.selectedOptions, (o) => o.value))}>
                    {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                );
              }
              return (
                <select key={key} data-field={f.name} style={style} value={typeof v === "string" ? v : ""} onChange={(e) => set(f.name, e.target.value)}>
                  <option value="" />
                  {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              );
            default:
              return <div key={key} className="unsupportedField" data-field={f.name} style={style} title="This field type isn't supported yet" />;
          }
        }),
      )}
    </div>
  );
}
