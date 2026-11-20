type Listener = (open: boolean) => void;

let pending: { promise: Promise<boolean>; resolve: (ok: boolean) => void } | null = null;
const listeners = new Set<Listener>();

// Plusieurs appels simultanés partagent le même modal
export function requestBotChallenge(): Promise<boolean> {
  if (pending) return pending.promise;
  let resolve!: (ok: boolean) => void;
  const promise = new Promise<boolean>((r) => (resolve = r));
  pending = { promise, resolve };
  listeners.forEach((l) => l(true));
  return promise;
}

export function settleBotChallenge(ok: boolean) {
  const p = pending;
  pending = null;
  listeners.forEach((l) => l(false));
  p?.resolve(ok);
}

export function subscribeBotChallenge(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}