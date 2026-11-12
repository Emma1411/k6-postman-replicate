import { EventEmitter } from "node:events";
import type { MainToWorker, WorkerToMain } from "@/server/engine/workers/protocol";
import { createWorkerRuntime } from "@/server/engine/workers/worker-runtime";

export class InProcessWorker extends EventEmitter {
  private readonly runtime = createWorkerRuntime((message: WorkerToMain) => {
    queueMicrotask(() => this.emit("message", message));
  });

  constructor() {
    super();
    setImmediate(() => this.emit("message", { type: "ready" } satisfies WorkerToMain));
  }

  postMessage(message: MainToWorker): void {
    this.runtime.handle(message);
  }

  async terminate(): Promise<number> {
    this.runtime.dispose();
    this.emit("exit", 0);
    return 0;
  }
}