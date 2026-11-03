import { noopMetrics } from "../src/metrics";

test("noopMetrics is safe to call and does nothing observable", () => {
  expect(() => noopMetrics.increment("x")).not.toThrow();
  expect(() => noopMetrics.increment("x", { tag: "a" })).not.toThrow();
  expect(() => noopMetrics.observe("x", 1)).not.toThrow();
  expect(() => noopMetrics.setGauge("x", 1)).not.toThrow();
});
