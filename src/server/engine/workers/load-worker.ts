import { parentPort } from "node:worker_threads";
import { createWorkerRuntime } from "./worker-runtime";
import type { MainToWorker } from "./protocol";

if (!parentPort) throw new Error("load-worker doit être exécuté dans un worker_thread.");
const port = parentPort;

const runtime = createWorkerRuntime((message) => port.postMessage(message));
port.on("message", (message: MainToWorker) => runtime.handle(message));
port.postMessage({ type: "ready" });