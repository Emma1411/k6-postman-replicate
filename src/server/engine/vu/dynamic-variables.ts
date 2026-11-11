import "server-only";
import { randomInt, randomUUID } from "node:crypto";
import type { Variables } from "@/shared/schemas";

/** Variables recalculées à chaque étape : {{$uuid}}, {{$timestamp}}, {{$randomInt}}, {{$vu}}, {{$iteration}}. */
export function dynamicVariables(vu: number, iteration: number): Variables {
  return {
    $vu: String(vu),
    $iteration: String(iteration),
    $uuid: randomUUID(),
    $timestamp: String(Date.now()),
    $randomInt: String(randomInt(0, 1000)),
  };
}