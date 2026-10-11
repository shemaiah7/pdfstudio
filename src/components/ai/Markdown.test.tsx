// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import Markdown from "./Markdown";

describe("Markdown", () => {
  afterEach(cleanup);

  it("renders a citation inside bold as a PageLink inside strong", () => {
    const { container } = render(<Markdown text="**Total (p. 3)** next" />);
    const strong = container.querySelector("strong")!;
    expect(strong.textContent).toContain("Total");
    expect(strong.querySelector("button.pagelink")!.textContent).toBe("p. 3");
    expect(container.querySelector("p")!.textContent).toBe("Total p. 3 next");
  });

  it("renders unclosed bold literally", () => {
    const { container } = render(<Markdown text="**unclosed bold" />);
    expect(container.querySelector("strong")).toBeNull();
    expect(container.textContent).toBe("**unclosed bold");
  });

  it("renders numbered lists as ol", () => {
    const { container } = render(<Markdown text={"1. one\n2) two"} />);
    expect(container.querySelectorAll("ol > li").length).toBe(2);
  });

  it("renders a lead-in paragraph followed by a list", () => {
    const { container } = render(<Markdown text={"Key points:\n- a\n- b"} />);
    expect(container.querySelectorAll("p").length).toBe(1);
    expect(container.querySelectorAll("ul > li").length).toBe(2);
  });
});
