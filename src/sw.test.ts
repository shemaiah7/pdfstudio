import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const SRC = readFileSync(resolve(__dirname, "../public/sw.js"), "utf8");

/** Runs public/sw.js against an in-memory Cache Storage and a scripted fetch; returns its fetch handler and the caches. */
function load(network: (url: string) => Response) {
  const stores = new Map<string, Map<string, Response>>();
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name)!;
      const key = (r: Request | string) => (typeof r === "string" ? r : r.url);
      return {
        match: async (r: Request | string) => m.get(key(r))?.clone(),
        put: async (r: Request | string, res: Response) => { m.set(key(r), res); },
        delete: async (r: Request | string) => m.delete(key(r)),
        keys: async () => [...m.keys()].map((u) => new Request(u)),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (n: string) => stores.delete(n),
    match: async () => undefined,
  };
  const listeners: Record<string, (e: unknown) => void> = {};
  const self = { location: { origin: "https://sentinelpdf.com" }, addEventListener: (t: string, f: (e: unknown) => void) => { listeners[t] = f; }, skipWaiting: () => {}, clients: { claim: async () => {} } };
  runInNewContext(SRC, { self, caches, fetch: async (r: Request) => network(r.url), URL, Request, Response, console });
  const get = async (url: string) => {
    let p: Promise<Response> | undefined;
    listeners.fetch({ request: new Request(url), respondWith: (x: Promise<Response>) => { p = x; } });
    return p!;
  };
  return { get, stores };
}

const JS = () => new Response("console.log(1)", { status: 200, headers: { "content-type": "text/javascript" } });
const HTML = () => new Response("<!doctype html><div id=root></div>", { status: 200, headers: { "content-type": "text/html" } });

describe("service worker static cache", () => {
  it("never caches an HTML fallback served for a new /assets/ URL right after a deploy", async () => {
    let served = HTML;
    const { get, stores } = load(() => served());
    const first = await get("https://sentinelpdf.com/assets/index-new.js");
    expect(first.headers.get("content-type")).toContain("text/html");
    expect(stores.get("pdfstudio-assets-v2")?.size ?? 0).toBe(0);
    served = JS;
    const second = await get("https://sentinelpdf.com/assets/index-new.js");
    expect(second.headers.get("content-type")).toContain("javascript");
    expect(stores.get("pdfstudio-assets-v2")?.size).toBe(1);
  });

  it("caches real scripts and serves them from cache next time", async () => {
    let calls = 0;
    const { get } = load(() => { calls++; return JS(); });
    await get("https://sentinelpdf.com/assets/a.js");
    await get("https://sentinelpdf.com/assets/a.js");
    expect(calls).toBe(1);
  });
});
