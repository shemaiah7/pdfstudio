import { describe, it, expect } from "vitest";
import { validateAiBody, MAX_DOC_CHARS } from "../src/validate";

const doc = [{ page: 1, text: "hello" }];

describe("validateAiBody", () => {
  it("accepts summarize", () => {
    expect(validateAiBody({ task: "summarize", document: doc })).toMatchObject({ ok: true });
  });
  it("requires question for ask", () => {
    expect(validateAiBody({ task: "ask", document: doc })).toMatchObject({ ok: false, status: 400 });
    expect(validateAiBody({ task: "ask", document: doc, question: "why?" })).toMatchObject({ ok: true });
  });
  it("requires selection and mode for rewrite; language for translate", () => {
    expect(validateAiBody({ task: "rewrite", document: doc, selection: "x" })).toMatchObject({ ok: false });
    expect(validateAiBody({ task: "rewrite", document: doc, selection: "x", mode: "translate" })).toMatchObject({ ok: false });
    expect(validateAiBody({ task: "rewrite", document: doc, selection: "x", mode: "translate", language: "fr" })).toMatchObject({ ok: true });
  });
  it("rejects oversized documents with 413", () => {
    const big = [{ page: 1, text: "a".repeat(MAX_DOC_CHARS + 1) }];
    expect(validateAiBody({ task: "summarize", document: big })).toMatchObject({ ok: false, status: 413, error: "document_too_large", maxChars: MAX_DOC_CHARS });
  });
  it("rejects garbage", () => {
    expect(validateAiBody(null)).toMatchObject({ ok: false, status: 400 });
    expect(validateAiBody({ task: "fly", document: doc })).toMatchObject({ ok: false, status: 400 });
  });
  it("caps history at 10 turns", () => {
    const history = Array.from({ length: 11 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: "t" }));
    expect(validateAiBody({ task: "ask", document: doc, question: "q", history })).toMatchObject({ ok: false, status: 400 });
  });
  it("rejects empty history turns", () => {
    expect(validateAiBody({ task: "ask", document: doc, question: "q", history: [{ role: "user", text: "" }] })).toMatchObject({ ok: false, status: 400 });
  });
});
