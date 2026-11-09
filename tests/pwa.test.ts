import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";
import { buildAssetLinks } from "@/lib/pwa/asset-links";

const root = join(__dirname, "..");

describe("web app manifest", () => {
  const m = manifest();

  it("meets Android install requirements", () => {
    expect(m.name).toBe("CoreTech Recruiting");
    expect(m.display).toBe("standalone");
    expect(m.start_url?.startsWith(m.scope ?? "/")).toBe(true);
    const sizes = (m.icons ?? []).map((i) => `${i.sizes}:${i.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
  });

  it("references icon files that exist with the declared dimensions", async () => {
    for (const icon of m.icons ?? []) {
      const meta = await sharp(join(root, "public", icon.src)).metadata();
      expect(`${meta.width}x${meta.height}`, icon.src).toBe(icon.sizes);
      expect(meta.format).toBe("png");
    }
  });

  it("only links shortcuts to real public pages", () => {
    for (const s of m.shortcuts ?? []) expect(s.url).toMatch(/^\/(jobs|employers|contact)\?/);
  });
});

describe("Android asset links", () => {
  const fp = Array.from({ length: 32 }, () => "AB").join(":");

  it("is empty until configured", () => {
    expect(buildAssetLinks({})).toEqual([]);
  });

  it("builds a TWA statement from valid config", () => {
    expect(
      buildAssetLinks({ ANDROID_TWA_PACKAGE_NAME: "com.coretechrecruiting.app", ANDROID_TWA_SHA256_FINGERPRINTS: fp.toLowerCase() }),
    ).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: { namespace: "android_app", package_name: "com.coretechrecruiting.app", sha256_cert_fingerprints: [fp] },
      },
    ]);
  });

  it("rejects partial or malformed config", () => {
    expect(() => buildAssetLinks({ ANDROID_TWA_PACKAGE_NAME: "com.example.app" })).toThrow();
    expect(() => buildAssetLinks({ ANDROID_TWA_PACKAGE_NAME: "not a package", ANDROID_TWA_SHA256_FINGERPRINTS: fp })).toThrow();
    expect(() => buildAssetLinks({ ANDROID_TWA_PACKAGE_NAME: "com.example.app", ANDROID_TWA_SHA256_FINGERPRINTS: "AB:CD" })).toThrow();
  });
});

/** Runs public/sw.js in a minimal fake service-worker global and returns hooks to drive it. */
function loadServiceWorker(network: (req: Request) => Promise<Response>) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const stores = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      match: async (req: Request | string) => store.get(typeof req === "string" ? req : new URL(req.url).pathname)?.clone(),
      put: async (req: Request | string, res: Response) => {
        store.set(typeof req === "string" ? req : new URL(req.url).pathname, res);
      },
    };
  };
  const caches = {
    open,
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (key: string) => {
      for (const store of stores.values()) if (store.has(key)) return store.get(key)!.clone();
      return undefined;
    },
  };
  const self = {
    location: new URL("https://coretech.example/"),
    addEventListener: (type: string, fn: (event: unknown) => void) => (listeners[type] = fn),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
    registration: {},
  };
  const fetchFn = async (input: Request | string) =>
    network(typeof input === "string" ? new Request(new URL(input, self.location)) : input);

  // In a real worker, relative Request URLs resolve against the worker's location.
  class WorkerRequest extends Request {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, self.location) : input, init);
    }
  }

  vm.runInNewContext(readFileSync(join(root, "public", "sw.js"), "utf8"), {
    self, caches, fetch: fetchFn, Request: WorkerRequest, Response, URL, Set, console,
  });

  async function dispatchFetch(url: string, { mode, ...init }: RequestInit & { mode?: RequestMode } = {}) {
    const request = new Request(url, init);
    // Request.mode can't be set to "navigate" by constructor, so expose it explicitly.
    Object.defineProperty(request, "mode", { value: mode ?? "cors" });
    let responded: Promise<Response> | undefined;
    listeners.fetch({ request, preloadResponse: Promise.resolve(undefined), respondWith: (p: Promise<Response>) => (responded = p) });
    return responded;
  }

  async function install() {
    let done: Promise<unknown> | undefined;
    listeners.install({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
  }

  return { install, dispatchFetch, stores };
}

describe("service worker", () => {
  it("caches the offline page without cookies at install", async () => {
    const seen: Request[] = [];
    const sw = loadServiceWorker(async (req) => {
      seen.push(req);
      return new Response("offline page");
    });
    await sw.install();
    expect(seen[0].credentials).toBe("omit");
    expect(new URL(seen[0].url).pathname).toBe("/offline");
  });

  it("never caches pages and falls back to /offline when the network fails", async () => {
    let online = true;
    const sw = loadServiceWorker(async (req) => {
      if (new URL(req.url).pathname === "/offline") return new Response("offline page");
      if (!online) throw new TypeError("Failed to fetch");
      return new Response("private candidate page");
    });
    await sw.install();

    const live = await sw.dispatchFetch("https://coretech.example/recruiter/candidates", { mode: "navigate" });
    expect(await live!.text()).toBe("private candidate page");

    online = false;
    const offline = await sw.dispatchFetch("https://coretech.example/recruiter/candidates", { mode: "navigate" });
    expect(await offline!.text()).toBe("offline page");

    const cachedBodies = await Promise.all(
      [...sw.stores.values()].flatMap((s) => [...s.values()]).map((r) => r.clone().text()),
    );
    expect(cachedBodies).not.toContain("private candidate page");
  });

  it("leaves form posts, server actions and cross-origin requests alone", async () => {
    const sw = loadServiceWorker(async () => new Response("x"));
    expect(await sw.dispatchFetch("https://coretech.example/contact", { method: "POST", body: "a=1" })).toBeUndefined();
    expect(await sw.dispatchFetch("https://images.unsplash.com/photo-1")).toBeUndefined();
    expect(await sw.dispatchFetch("https://coretech.example/recruiter/candidates/1/resumes/2")).toBeUndefined();
  });

  it("caches immutable build assets", async () => {
    let calls = 0;
    const sw = loadServiceWorker(async () => {
      calls += 1;
      const res = new Response("js", { status: 200 });
      // Node builds responses with type "default"; browsers mark same-origin ones "basic".
      Object.defineProperty(res, "type", { value: "basic" });
      return res;
    });
    const url = "https://coretech.example/_next/static/chunks/app.js";
    expect(await (await sw.dispatchFetch(url))!.text()).toBe("js");
    expect(await (await sw.dispatchFetch(url))!.text()).toBe("js");
    expect(calls).toBe(1);
  });
});
