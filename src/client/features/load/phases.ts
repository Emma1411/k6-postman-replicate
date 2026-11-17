import type { ExecutorConfig } from "@/shared/schemas";

export interface PhaseSpan {
  label: string;
  startSeconds: number;
  endSeconds: number;
}

function fromStages(start: number, stages: Array<{ durationSeconds: number; target: number }>): PhaseSpan[] {
  const spans: PhaseSpan[] = [];
  let previous = start;
  let cursor = 0;
  for (const stage of stages) {
    const label = stage.target > previous ? "Montée" : stage.target < previous ? "Descente" : "Palier";
    spans.push({ label, startSeconds: cursor, endSeconds: cursor + stage.durationSeconds });
    cursor += stage.durationSeconds;
    previous = stage.target;
  }
  return spans;
}

/** Les phases d'un test, déduites du scénario envoyé au serveur. */
export function describePhases(executor: ExecutorConfig): PhaseSpan[] {
  switch (executor.type) {
    case "constant-vus":
      return [{ label: "Palier constant", startSeconds: 0, endSeconds: executor.durationSeconds }];
    case "constant-arrival-rate":
      return [{ label: "Cadence fixe", startSeconds: 0, endSeconds: executor.durationSeconds }];
    case "ramping-vus":
      return fromStages(executor.startVus, executor.stages);
    case "ramping-arrival-rate":
      return fromStages(executor.startRate, executor.stages);
    default:
      return [{ label: "Exécution", startSeconds: 0, endSeconds: executor.maxDurationSeconds }];
  }
}

/** La phase en cours à `t` secondes (la fin d'une fenêtre appartient à la phase qui se termine). */
export function phaseAt(spans: PhaseSpan[], t: number): PhaseSpan | null {
  if (spans.length === 0) return null;
  return spans.find((s) => t > s.startSeconds && t <= s.endSeconds) ?? (t <= 0 ? spans[0] : spans[spans.length - 1]);
}