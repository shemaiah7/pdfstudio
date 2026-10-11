// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import FormLayer from "./FormLayer";
import { useDocumentStore } from "../store/document";
import type { FieldDef } from "../pdf/forms";

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
afterEach(cleanup);

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
});
