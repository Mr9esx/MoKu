import type { EfficiencyPoint } from "./types";

/** Counts completed rounds; neither candidate evaluations nor clock ticks count. */
export class PatienceTracker {
  best: number | null;
  unchanged = 0;
  curve: EfficiencyPoint[];
  constructor(readonly limit: number, baseline: number | null) {
    this.best = baseline;
    this.curve = [{ generation: 0, efficiency: baseline, unchanged: 0 }];
  }
  observe(generation: number, efficiency: number | null): boolean {
    if (efficiency !== null && (this.best === null || efficiency > this.best + 1e-9)) {
      this.best = efficiency;
      this.unchanged = 0;
    } else this.unchanged++;
    this.curve = [...this.curve, { generation, efficiency: this.best, unchanged: this.unchanged }];
    // Keep a bounded plot history; the exact stopping counter is never sampled.
    if (this.curve.length > 2048)
      this.curve = this.curve.filter((_, i, all) => i % 2 === 0 || i === all.length - 1);
    return this.unchanged >= this.limit;
  }
}
