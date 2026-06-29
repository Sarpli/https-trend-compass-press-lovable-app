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

describe("chunk-retry exponential backoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("first retry runs immediately; later retries wait 1s, 2s, 4s, 8s, capped at 30s", async () => {
    // Attempt 1: no delay, fetch fails.
    fetchSpy.mockRejectedValue(new TypeError("Failed to fetch"));

    await api.runRetry("toast-1");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Attempt 2: should wait 1s before fetching.
    const p2 = api.runRetry("toast-1");
    expect(fetchSpy).toHaveBeenCalledTimes(1); // not yet
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await p2;
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Attempt 3: 2s.
    const p3 = api.runRetry("toast-1");
    await vi.advanceTimersByTimeAsync(2000);
    await p3;
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    // Attempt 4: 4s.
    const p4 = api.runRetry("toast-1");
    await vi.advanceTimersByTimeAsync(4000);
    await p4;
    expect(fetchSpy).toHaveBeenCalledTimes(4);

    // Attempt 5: 8s.
    const p5 = api.runRetry("toast-1");
    await vi.advanceTimersByTimeAsync(8000);
    await p5;
    expect(fetchSpy).toHaveBeenCalledTimes(5);

    // The "Still offline" toast advertises the next wait.
    const lastOffline = toastError.mock.calls.at(-1) as [string, { description: string }];
    expect(lastOffline[0]).toBe("Still offline");
    expect(lastOffline[1].description).toMatch(/Next retry waits 16s/);
  });

  it("backoff caps at 30s no matter how many failures pile up", async () => {
    fetchSpy.mockRejectedValue(new TypeError("Failed to fetch"));
    // Burn through enough attempts to exceed the cap (2^5 = 32s > 30s).
    for (let i = 0; i < 8; i++) {
      const p = api.runRetry("toast-1");
      await vi.advanceTimersByTimeAsync(30_000);
      await p;
    }
    // Drive one more attempt and verify the wait is exactly 30s, not longer.
    const p = api.runRetry("toast-1");
    await vi.advanceTimersByTimeAsync(29_999);
    const callsBefore = fetchSpy.mock.calls.length;
    expect(fetchSpy).toHaveBeenCalledTimes(callsBefore);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(fetchSpy).toHaveBeenCalledTimes(callsBefore + 1);
  });

  it("a successful retry resets backoff so the next cycle starts at 0", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch")); // attempt 1 fails
    await api.runRetry("toast-1");

    // Attempt 2 succeeds — should still wait 1s, then replace, then reset.
    fetchSpy.mockResolvedValueOnce(new Response("ok"));
    const p2 = api.runRetry("toast-1");
    await vi.advanceTimersByTimeAsync(1000);
    await p2;
    expect(replaceSpy).toHaveBeenCalledTimes(1);

    // A subsequent retry (new failure) should be immediate again.
    fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const callsBefore = fetchSpy.mock.calls.length;
    const p3 = api.runRetry("toast-1");
    // No timer advance — should fetch synchronously on the microtask queue.
    await p3;
    expect(fetchSpy).toHaveBeenCalledTimes(callsBefore + 1);
  });
});