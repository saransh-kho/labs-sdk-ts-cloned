// Pluggable metrics abstraction (counters/gauges), separate from the
// LabsDecisionTracer log/trace hook. Node consumers typically wire in a real
// backend (Prometheus, StatsD, etc.); the core package ships only this
// interface and a no-op default so neither build (Node or browser) bundles a
// metrics backend of its own.
export interface MetricsInterface {
  increment(name: string, tags?: Record<string, string>): void;
  observe(name: string, value: number, tags?: Record<string, string>): void;
  setGauge(name: string, value: number, tags?: Record<string, string>): void;
}

export const noopMetrics: MetricsInterface = {
  increment() {
    return;
  },
  observe() {
    return;
  },
  setGauge() {
    return;
  },
};
