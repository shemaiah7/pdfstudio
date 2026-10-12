import { test, expect } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

async function notePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([400, 300]);
  p.drawText("Medication list. Warfarin 5 mg nightly. INR goal 2 to 3.", { x: 30, y: 250, size: 11, font });
  return Buffer.from(await doc.save());
}

test("voice session: start, tool search, captions, end reports usage", async ({ page }) => {
  await page.route("**/session", (r) => r.fulfill({ json: { token: "t", expiresAt: 9999999999 } }));
  await page.route("**/live", (r) => r.fulfill({ json: { conversationId: "conv_e2e", token: "el", remainingSeconds: 1200, resetAt: 0 } }));
  const usage: unknown[] = [];
  await page.route("**/live/usage", async (r) => { usage.push(r.request().postDataJSON()); await r.fulfill({ json: { remainingSeconds: 1785 } }); });
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__pdfstudioLiveStub = {
      getMedia: async () => {},
      startSession: async (opts: Record<string, any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        w.__liveOpts = opts;
        setTimeout(() => opts.onConnect?.(), 0);
        return { endSession: async () => { setTimeout(() => opts.onDisconnect?.({ reason: "user" }), 0); }, sendContextualUpdate: () => {}, setMicMuted: () => {}, getId: () => "conv_e2e" };
      },
    };
  });
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', { name: "note.pdf", mimeType: "application/pdf", buffer: await notePdf() });
  await expect(page.locator(".page .textLayer span").first()).toBeVisible();
  await page.getByTestId("panel-tab-voice").click();
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("voice-start").click();
  await expect(page.getByTestId("voice-status")).toContainText("min left today");
  const result = await page.evaluate(() => (window as unknown as { __liveOpts: { clientTools: { search_document(p: { query: string }): Promise<string> } } }).__liveOpts.clientTools.search_document({ query: "warfarin dose" }));
  expect(result).toMatch(/^\[p\. 1\] .*Warfarin 5 mg nightly/);
  await page.evaluate(() => { const o = (window as unknown as { __liveOpts: Record<string, any> }).__liveOpts; o.onMessage({ role: "user", message: "what is the warfarin dose", event_id: 1 }); o.onMessage({ role: "agent", message: "Five milligrams nightly, page 1.", event_id: 2 }); }); // eslint-disable-line @typescript-eslint/no-explicit-any
  await expect(page.getByTestId("voice-captions")).toContainText("Five milligrams nightly");
  await expect(page.getByText("Using keyword matching (search model not loaded)")).toBeVisible();
  await page.getByTestId("voice-end").click();
  await expect(page.getByTestId("voice-start")).toBeVisible();
  await expect.poll(() => usage.length).toBe(1);
  expect(usage[0]).toMatchObject({ conversationId: "conv_e2e" });
  await expect(page.getByText("29 min left today")).toBeVisible();
});
