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
  it("accepts retrieved ask up to 40 passages of 4000 chars and rejects more", () => {
    const ok = Array.from({ length: 40 }, (_, i) => ({ page: i + 1, text: "x".repeat(4000) }));
    expect(validateAiBody({ task: "ask", document: ok, question: "q", retrieved: true })).toMatchObject({ ok: true });
    expect(validateAiBody({ task: "ask", document: [...ok, { page: 41, text: "x" }], question: "q", retrieved: true })).toMatchObject({ ok: false, status: 400 });
    expect(validateAiBody({ task: "ask", document: [{ page: 1, text: "x".repeat(4001) }], question: "q", retrieved: true })).toMatchObject({ ok: false, status: 400 });
  });
});

import { validateOcrBody } from "../src/validate";
describe("validateOcrBody", () => {
  const img = "/9j/4AAQ";
  it("accepts 1 to 20 pages", () => {
    expect(validateOcrBody({ task: "ocr", pages: [{ page: 1, image: img }] }).ok).toBe(true);
    expect(validateOcrBody({ task: "ocr", pages: Array.from({ length: 20 }, (_, i) => ({ page: i + 1, image: img })) }).ok).toBe(true);
  });
  it("rejects 0 or 21 pages and bad shapes", () => {
    expect(validateOcrBody({ task: "ocr", pages: [] })).toMatchObject({ ok: false, status: 400 });
    expect(validateOcrBody({ task: "ocr", pages: Array.from({ length: 21 }, (_, i) => ({ page: i + 1, image: img })) })).toMatchObject({ ok: false, status: 400 });
    expect(validateOcrBody({ task: "summarize", pages: [] })).toMatchObject({ ok: false });
  });
  it("413 on an oversized image", () => {
    expect(validateOcrBody({ task: "ocr", pages: [{ page: 1, image: "a".repeat(5_400_001) }] })).toMatchObject({ ok: false, status: 413, error: "image_too_large" });
  });
});
