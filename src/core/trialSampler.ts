import type { SearchTrial } from "./types";
/** Keep the latest complete trial; failed attempts must not replace a full drawing. */
export class LatestTrialSampler {
  private pending: SearchTrial | null = null;
  private lastSent = -Infinity;
  constructor(private intervalMs = 300) {}
  offer(trial: SearchTrial, now: number): SearchTrial | null {
    if (!trial.complete) return null;
    this.pending = trial;
    return this.flush(now);
  }
  flush(now: number): SearchTrial | null {
    if (!this.pending || now - this.lastSent < this.intervalMs) return null;
    const latest = this.pending;
    this.pending = null;
    this.lastSent = now;
    return latest;
  }
}
