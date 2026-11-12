import type { IterationFn } from "./types";
import { sleep } from "./timing";

export interface VuLoopsOptions {
  runIteration: IterationFn;
  signal: AbortSignal;
  shareIndex: number;
  shareCount: number;
  /** Nombre maximal d'itérations par VU. */
  iterationLimit?: number;
  /** Appelée avant chaque itération ; renvoie faux quand il n'y a plus d'itération à faire. */
  claim?: () => boolean;
}

interface Loop {
  stop: boolean;
  promise: Promise<void>;
}

/**
 * Boucles de VUs d'un worker. Un VU enchaîne les itérations jusqu'à ce qu'on lui demande de s'arrêter,
 * ce qu'il fait après avoir terminé l'itération en cours (arrêt progressif).
 */
export class VuLoops {
  private readonly loops = new Map<number, Loop>();
  private readonly options: VuLoopsOptions;

  constructor(options: VuLoopsOptions) {
    this.options = options;
  }

  /** VUs qui continueront à tourner (hors VUs en cours d'arrêt). */
  get active(): number {
    let n = 0;
    for (const loop of this.loops.values()) if (!loop.stop) n++;
    return n;
  }

  /** Ajuste le nombre de VUs : démarre les manquants, relance ceux en cours d'arrêt, arrête les surnuméraires. */
  scaleTo(n: number): void {
    for (const [slot, loop] of this.loops) if (slot >= n) loop.stop = true;
    for (let slot = 0; slot < n; slot++) {
      const loop = this.loops.get(slot);
      if (!loop) this.start(slot);
      else loop.stop = false;
    }
  }

  stopAll(): void {
    for (const loop of this.loops.values()) loop.stop = true;
  }

  /** Se résout quand toutes les boucles actuelles sont terminées. */
  idle(): Promise<void> {
    return Promise.all([...this.loops.values()].map((l) => l.promise)).then(() => undefined);
  }

  private start(slot: number): void {
    const { runIteration, signal, shareIndex, shareCount, iterationLimit, claim } = this.options;
    const vu = slot * shareCount + shareIndex + 1;
    const loop: Loop = { stop: false, promise: Promise.resolve() };

    loop.promise = (async () => {
      let iteration = 0;
      while (!loop.stop && !signal.aborted) {
        if (iterationLimit !== undefined && iteration >= iterationLimit) break;
        if (claim && !claim()) break;
        iteration++;

        const startedAt = Date.now();
        try {
          await runIteration({ vu, iteration });
        } catch {
          /* l'itération gère ses erreurs : on ne laisse jamais mourir la boucle */
        }
        // Une itération quasi instantanée ne doit pas monopoliser la boucle d'événements.
        if (Date.now() - startedAt < 1) await sleep(1, signal);
      }
    })().finally(() => {
      if (this.loops.get(slot) === loop) this.loops.delete(slot);
    });

    this.loops.set(slot, loop);
  }
}