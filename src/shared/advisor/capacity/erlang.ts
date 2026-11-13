/**
 * Probabilité qu'une requête doive attendre (formule d'Erlang-C), pour `servers` serveurs
 * et une charge offerte `offeredLoad` = λ/μ. Calcul stable par récurrence d'Erlang-B.
 */
export function erlangC(servers: number, offeredLoad: number): number {
  if (offeredLoad <= 0) return 0;
  if (offeredLoad >= servers) return 1;

  let b = 1;
  for (let i = 1; i <= servers; i++) b = (offeredLoad * b) / (i + offeredLoad * b);
  const rho = offeredLoad / servers;
  return b / (1 - rho * (1 - b));
}

export interface QueueInput {
  /** Nombre de serveurs (vCPU entiers). */
  servers: number;
  /** Temps de service d'une requête sur un serveur, en ms. */
  serviceMs: number;
  /** Débit d'arrivée vers cette file, en requêtes par seconde. */
  arrivalPerSec: number;
  /** Carré du coefficient de variation du temps de service (1 = exponentiel). */
  variability?: number;
}

export interface QueueResult {
  stable: boolean;
  /** Utilisation de chaque serveur (0 à 1 ; ≥ 1 = instable). */
  utilization: number;
  waitProbability: number;
  meanWaitMs: number;
  /** Quantile 95 du temps d'attente (0 si moins de 5 % des requêtes attendent). */
  waitP95Ms: number;
}

/**
 * File M/M/c. L'attente d'une requête qui attend suit une loi exponentielle de taux (c·μ − λ) ;
 * le coefficient de variation du temps de service corrige ce taux (approximation d'Allen-Cunneen).
 */
export function mmcQueue(input: QueueInput): QueueResult {
  const { servers, serviceMs, arrivalPerSec: lambda } = input;
  const cs2 = input.variability ?? 1;
  const mu = 1000 / serviceMs;
  const offered = lambda / mu;
  const rho = offered / servers;

  if (lambda <= 0) return { stable: true, utilization: 0, waitProbability: 0, meanWaitMs: 0, waitP95Ms: 0 };
  if (rho >= 1) {
    return { stable: false, utilization: rho, waitProbability: 1, meanWaitMs: Infinity, waitP95Ms: Infinity };
  }

  const c = erlangC(servers, offered);
  const rate = (servers * mu - lambda) / ((1 + cs2) / 2);
  return {
    stable: true,
    utilization: rho,
    waitProbability: c,
    meanWaitMs: (c / rate) * 1000,
    waitP95Ms: c > 0.05 ? (Math.log(c / 0.05) / rate) * 1000 : 0,
  };
}