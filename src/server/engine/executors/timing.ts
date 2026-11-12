/** Attend `ms` millisecondes. Se termine tôt (sans erreur) si le signal est annulé. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, Math.max(0, ms));
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

export function sleepUntil(epochMs: number, signal?: AbortSignal): Promise<void> {
  const ms = epochMs - Date.now();
  return ms > 0 ? sleep(ms, signal) : Promise.resolve();
}