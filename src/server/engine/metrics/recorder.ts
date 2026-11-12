import "server-only";
import { Histogram } from "./histogram";
import type { RequestSample, WindowDelta } from "./types";

/** Collecteur d'un worker : accumule, puis `flush()` renvoie la fenêtre écoulée et repart de zéro. */
export class MetricsRecorder {
  private readonly duration = new Histogram();
  private readonly iterationDuration = new Histogram();
  private readonly status = new Map<string, number>();
  private requests = 0;
  private failed = 0;
  private checksPassed = 0;
  private checksFailed = 0;
  private iterations = 0;
   private dropped = 0;
  private dataSent = 0;
  private dataReceived = 0;
  private vus = 0;

  setVus(count: number): void {
    this.vus = count;
  }

  recordRequest(sample: RequestSample): void {
    this.requests++;
    if (sample.failed) this.failed++;
    const key = sample.status === null ? "error" : String(sample.status);
    this.status.set(key, (this.status.get(key) ?? 0) + 1);
    if (sample.durationMs !== null) this.duration.record(sample.durationMs * 1000);
    this.dataSent += sample.bytesSent;
    this.dataReceived += sample.bytesReceived;
  }

  recordChecks(passed: number, failed: number): void {
    this.checksPassed += passed;
    this.checksFailed += failed;
  }

  recordIteration(durationMs: number): void {
    this.iterations++;
    this.iterationDuration.record(durationMs * 1000);
  }

   recordDropped(count: number): void {
    this.dropped += count;
  }

  flush(): WindowDelta {
    const delta: WindowDelta = {
      requests: this.requests,
      failed: this.failed,
      checksPassed: this.checksPassed,
      checksFailed: this.checksFailed,
      iterations: this.iterations,
       dropped: this.dropped,
      dataSent: this.dataSent,
      dataReceived: this.dataReceived,
      vus: this.vus,
      status: Object.fromEntries(this.status),
      duration: this.duration.toSnapshot(),
      iterationDuration: this.iterationDuration.toSnapshot(),
    };

    this.requests = 0;
    this.failed = 0;
    this.checksPassed = 0;
    this.checksFailed = 0;
    this.iterations = 0;
    this.dropped = 0;
    this.dataSent = 0;
    this.dataReceived = 0;
    this.status.clear();
    this.duration.reset();
    this.iterationDuration.reset();
    return delta;
  }
}