// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks must be declared before importing the module under test.
const toastError = vi.fn((_msg: string, _opts: unknown) => "toast-1");
const toastLoading = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (msg: string, opts: unknown) => toastError(msg, opts),
    loading: (msg: string, opts: unknown) => toastLoading(msg, opts),
    success: (msg: string, opts: unknown) => toastSuccess(msg, opts),
  },
}));

const insertMock = vi.fn(() => ({ then: (a: () => void) => { a(); return { then: () => {} }; } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ insert: insertMock }) },
}));

import { installChunkRetry, isChunkError } from "./chunk-retry";

type Api = NonNullable<ReturnType<typeof installChunkRetry>>;

let api: Api;
let replaceSpy: ReturnType<typeof vi.fn>;
let reloadSpy: ReturnType<typeof vi.fn>;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  toastError.mockClear();
  toastLoading.mockClear();
  insertMock.mockClear();

  replaceSpy = vi.fn();
  reloadSpy = vi.fn();
  // happy-dom's window.location is read-only; override via defineProperty.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      href: "https://app.test/route",
      replace: replaceSpy,
      reload: reloadSpy,
    },
  });

  fetchSpy = vi.fn().mockResolvedValue(new Response("ok"));
  vi.stubGlobal("fetch", fetchSpy);

  api = installChunkRetry()!;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isChunkError", () => {
  it("matches known stale-chunk messages", () => {
    expect(isChunkError("Importing a module script failed")).toBe(true);
    expect(isChunkError({ message: "Failed to fetch dynamically imported module" })).toBe(true);
    expect(isChunkError("ChunkLoadError: foo")).toBe(true);
  });
  it("ignores unrelated errors", () => {
    expect(isChunkError("ReferenceError: x is not defined")).toBe(false);
    expect(isChunkError(null)).toBe(false);
  });
});

describe("chunk-retry integration", () => {
  const chunkErr = new Error("Importing a module script failed");

  it("first chunk error triggers a single hard reload, not a toast", () => {
    api.maybeReload(chunkErr);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("trenslate-chunk-reload")).toBeTruthy();
  });

  it("second chunk error in same session shows the retry toast (non-escalated)", () => {
    sessionStorage.setItem("trenslate-chunk-reload", "1");
    api.maybeReload(chunkErr);
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
    const [msg, opts] = toastError.mock.calls[0] as [string, { action: { label: string } }];
    expect(msg).toBe("This page couldn't load");
    expect(opts.action.label).toBe("Reload");
  });

  it("after a pending retry that still failed, shows the escalated toast", () => {
    sessionStorage.setItem("trenslate-chunk-reload", "1");
    sessionStorage.setItem("trenslate-chunk-retry-pending", "1");
    api.maybeReload(chunkErr);
    const [msg, opts] = toastError.mock.calls[0] as [string, { action: { label: string } }];
    expect(msg).toBe("Retry didn't work");
    expect(opts.action.label).toBe("Try again");
    // The pending flag is consumed so the next cycle starts non-escalated.
    expect(sessionStorage.getItem("trenslate-chunk-retry-pending")).toBeNull();
  });

  it("runRetry success: swaps to loading toast, fetches no-store, hard-replaces", async () => {
    await api.runRetry("toast-1");
    expect(sessionStorage.getItem("trenslate-chunk-retry-pending")).toBe("1");
    expect(sessionStorage.getItem("trenslate-chunk-reload")).toBeNull();
    expect(toastLoading).toHaveBeenCalledWith(
      "Refreshing app…",
      expect.objectContaining({ id: "toast-1", duration: Infinity }),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://app.test/route",
      { cache: "no-store", credentials: "same-origin" },
    );
    expect(replaceSpy).toHaveBeenCalledWith("https://app.test/route");
  });

  it("runRetry offline failure: keeps toast open with retry action, no replace", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await api.runRetry("toast-1");
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "Still offline",
      expect.objectContaining({
        id: "toast-1",
        duration: Infinity,
        action: expect.objectContaining({ label: "Retry" }),
      }),
    );
    // The retry action wires back into runRetry so the user can try again.
    const opts = toastError.mock.calls[0][1] as { action: { onClick: () => void } };
    expect(typeof opts.action.onClick).toBe("function");
  });

  it("non-chunk errors are ignored entirely", () => {
    api.maybeReload(new Error("Something else"));
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("dedupes report inserts by fingerprint within the cooldown window", () => {
    api.maybeReload(chunkErr); // first → reload + 1 insert
    sessionStorage.setItem("trenslate-chunk-reload", "1");
    api.maybeReload(chunkErr); // second of same fingerprint → no new insert
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});