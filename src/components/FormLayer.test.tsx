// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import FormLayer from "./FormLayer";
import { useDocumentStore } from "../store/document";
import type { FieldDef } from "../pdf/forms";
import { useAccount } from "../account/store";
import { useSheets } from "./account/useGate";

const meta = { widthPt: 300, heightPt: 400, scale: 1, rotation: 0 as const };
const fields: FieldDef[] = [
  { name: "name", type: "text", widgets: [{ pageIndex: 0, rect: { x: 20, y: 300, width: 200, height: 24 } }] },
  { name: "agree", type: "checkbox", widgets: [{ pageIndex: 0, rect: { x: 20, y: 250, width: 14, height: 14 } }] },
  { name: "size", type: "radio", options: ["S", "L"], widgets: [{ pageIndex: 0, rect: { x: 20, y: 200, width: 14, height: 14 } }, { pageIndex: 0, rect: { x: 60, y: 200, width: 14, height: 14 } }] },
  { name: "color", type: "dropdown", options: ["Red", "Blue"], widgets: [{ pageIndex: 0, rect: { x: 20, y: 150, width: 80, height: 20 } }] },
  { name: "pick", type: "dropdown", multiple: true, options: ["a", "b", "c"], widgets: [{ pageIndex: 0, rect: { x: 20, y: 100, width: 80, height: 40 } }] },
  { name: "sig", type: "unsupported", widgets: [{ pageIndex: 0, rect: { x: 20, y: 50, width: 80, height: 30 } }] },
];
const val = (f: string) => useDocumentStore.getState().formValues.get("src")?.get(f);

beforeEach(() => useDocumentStore.setState({ formValues: new Map() }));
afterEach(() => { cleanup(); vi.unstubAllEnvs(); useAccount.setState({ me: null, loading: false }); useSheets.setState({ open: null }); });

describe("FormLayer", () => {
  const setup = () => render(<FormLayer sourceId="src" sourcePageIndex={0} fields={fields} meta={meta} />);
  it("typing sets a text value and positions the widget", () => {
    const { container } = setup();
    const el = container.querySelector("[data-field=name]") as HTMLInputElement;
    expect(el.style.left).toBe("20px");
    expect(el.style.top).toBe("76px");
    fireEvent.change(el, { target: { value: "Bob" } });
    expect(val("name")).toBe("Bob");
  });
  it("shows the field's initial value when the store has no entry", () => {
    const f: FieldDef[] = [{ name: "name", type: "text", value: "Zed", widgets: [{ pageIndex: 0, rect: { x: 0, y: 0, width: 10, height: 10 } }] }];
    const { container } = render(<FormLayer sourceId="src" sourcePageIndex={0} fields={f} meta={meta} />);
    expect((container.querySelector("[data-field=name]") as HTMLInputElement).value).toBe("Zed");
  });
  it("checkbox sets true", () => {
    const { container } = setup();
    fireEvent.click(container.querySelector("[data-field=agree]")!);
    expect(val("agree")).toBe(true);
  });
  it("radio widgets map to options by index", () => {
    const { container } = setup();
    const radios = container.querySelectorAll("input[data-field=size]");
    fireEvent.click(radios[1]);
    expect(val("size")).toBe("L");
    expect((radios[1] as HTMLInputElement).checked).toBe(true);
    expect((radios[0] as HTMLInputElement).checked).toBe(false);
  });
  it("dropdown and option list", () => {
    const { container } = setup();
    fireEvent.change(container.querySelector("select[data-field=color]")!, { target: { value: "Blue" } });
    expect(val("color")).toBe("Blue");
    const multi = container.querySelector("select[data-field=pick]") as HTMLSelectElement;
    expect(multi.multiple).toBe(true);
    (multi.options[0] as HTMLOptionElement).selected = true;
    (multi.options[2] as HTMLOptionElement).selected = true;
    fireEvent.change(multi);
    expect(val("pick")).toEqual(["a", "c"]);
  });
  it("unsupported renders a titled div", () => {
    const { container } = setup();
    const el = container.querySelector("[data-field=sig]")!;
    expect(el.tagName).toBe("DIV");
    expect(el.getAttribute("title")).toBe("This field type isn't supported yet");
    expect(container.querySelector("input[data-field=sig]")).toBeNull();
  });
  it("stops keydown propagation", () => {
    const { container } = setup();
    let seen = false;
    document.body.addEventListener("keydown", () => (seen = true));
    fireEvent.keyDown(container.querySelector("[data-field=name]")!, { key: "Backspace" });
    expect(seen).toBe(false);
  });
  it("on a free plan the fields are read-only and a click opens the paywall", () => {
    vi.stubEnv("VITE_PAYWALL_ENABLED", "true");
    useAccount.setState({ me: { plan: "free", paywall: true } as never });
    const { container } = setup();
    const text = container.querySelector("[data-field=name]") as HTMLInputElement;
    expect(text.readOnly).toBe(true);
    fireEvent.mouseDown(text);
    expect(useSheets.getState().open).toBe("paywall");
    fireEvent.click(container.querySelector("[data-field=agree]")!);
    expect(val("agree")).toBeUndefined();
    fireEvent.change(container.querySelector("select[data-field=color]")!, { target: { value: "Blue" } });
    expect(val("color")).toBeUndefined();
  });
  it("on a trial plan the fields are editable", () => {
    vi.stubEnv("VITE_PAYWALL_ENABLED", "true");
    useAccount.setState({ me: { plan: "trial", paywall: true } as never });
    const { container } = setup();
    fireEvent.change(container.querySelector("[data-field=name]")!, { target: { value: "Ann" } });
    expect(val("name")).toBe("Ann");
    expect(useSheets.getState().open).toBeNull();
  });
});

describe("FormLayer field flags", () => {
  const r = { pageIndex: 0, rect: { x: 0, y: 0, width: 50, height: 20 } };
  const flagged: FieldDef[] = [
    { name: "a", type: "text", maxLength: 8, widgets: [r] },
    { name: "ro", type: "text", readOnly: true, widgets: [r] },
    { name: "roc", type: "checkbox", readOnly: true, widgets: [r] },
    { name: "ros", type: "dropdown", options: ["x"], readOnly: true, widgets: [r] },
    { name: "ml", type: "text", multiline: true, widgets: [{ pageIndex: 0, rect: { x: 0, y: 0, width: 50, height: 60 } }] },
  ];
  const q = (c: HTMLElement, n: string) => c.querySelector(`[data-field=${n}]`) as HTMLInputElement;
  it("sets maxLength, readOnly/disabled with title, and renders a textarea for multiline", () => {
    const { container } = render(<FormLayer sourceId="src" sourcePageIndex={0} fields={flagged} meta={meta} />);
    expect(q(container, "a").maxLength).toBe(8);
    expect(q(container, "ro").readOnly).toBe(true);
    expect(q(container, "ro").title).toBe("This field is read-only");
    expect(q(container, "roc").disabled).toBe(true);
    expect(q(container, "ros").disabled).toBe(true);
    const ml = q(container, "ml");
    expect(ml.tagName).toBe("TEXTAREA");
    fireEvent.change(ml, { target: { value: "l1\nl2" } });
    expect(val("ml")).toBe("l1\nl2");
  });
});
