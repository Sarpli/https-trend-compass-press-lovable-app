/**
 * Vote reconciliation:
 * While a local vote mutation is in-flight, defer any realtime-triggered
 * cache invalidations so a server refetch can't overwrite our optimistic
 * score before the mutation settles. When the last in-flight mutation
 * ends, the deferred work runs once (deduped by tag).
 */
type Task = () => void;

let inflight = 0;
const deferred = new Map<string, Task>();

export function beginVoteMutation() {
  inflight += 1;
}

export function endVoteMutation() {
  inflight = Math.max(0, inflight - 1);
  if (inflight === 0 && deferred.size > 0) {
    const tasks = Array.from(deferred.values());
    deferred.clear();
    // Allow React to flush the mutation's onSettled invalidations first.
    queueMicrotask(() => tasks.forEach((t) => { try { t(); } catch { /* noop */ } }));
  }
}

export function isVoteMutationInflight() {
  return inflight > 0;
}

/**
 * Run `task` immediately when no mutation is pending; otherwise queue it
 * under `tag` (later queues with the same tag replace earlier ones — only
 * the latest version of each invalidation needs to run).
 */
export function runOrDeferRealtime(tag: string, task: Task) {
  if (inflight === 0) {
    task();
    return;
  }
  deferred.set(tag, task);
}