import * as _ from "lodash";
import * as uuid from "uuid";

import { ExperimentConfiguration, LabsTraceLevel } from "../src/types";
import { _internalDecisionService as DecisionService } from "../src/decision";
import { DefaultTracer } from "../src/internal/default_tracer";
import { Tracer } from "../src/internal/tracer";

const testTracer = new Tracer(new DefaultTracer(), LabsTraceLevel.ERROR);

// Pearson chi-squared upper-tail critical values (goodness-of-fit).
const CHI_SQUARED_CRITICAL_AT_001: Record<number, number> = {
  1: 10.828,
  2: 13.816,
  3: 16.266,
  4: 18.467,
  5: 20.515,
};

const DotComConfig: ExperimentConfiguration = {
  experiment_id: "70186a58-5a62-4bad-9cf1-be76938faec1",
  treatments: [
    {
      treatment_id: "71763efc-c873-4388-8f29-ad52b8798bd6",
      traffic_percentage: 50,
      title: "C",
      whitelist: {
        items: null,
      },
    },
    {
      treatment_id: "00f7b083-3c4b-452b-acd7-9a72641ffc44",
      traffic_percentage: 50,
      title: "T1",
      whitelist: {
        items: null,
      },
    },
  ],
  treatment_ids: ["71763efc-c873-4388-8f29-ad52b8798bd6", "00f7b083-3c4b-452b-acd7-9a72641ffc44"],
  experiment_type: "NON_CONTEXTUAL",
  algorithm_type: "BASIC",
  evaluation_order: null,
  total_enabled: true,
  is_feature: false,
  published: true,
  audience_group: undefined,
  num_of_unique_ctx_in_audience: 0,
  default_treatment: "71763efc-c873-4388-8f29-ad52b8798bd6",
};

const DotComConfigWithTraffic: ExperimentConfiguration = (function () {
  const config = _.cloneDeep(DotComConfig);
  config.traffic = {
    weight: 2000,
  };
  config.treatments[0].traffic = {
    weight: 5000,
    allocations: [
      {
        start: 1,
        end: 1000,
      },
    ],
  };
  config.treatments[1].traffic = {
    weight: 5000,
    allocations: [
      {
        start: 1001,
        end: 2000,
      },
    ],
  };
  return config;
})();

type DistributionStats = Record<string, Record<string, number>>;

type ChiSquaredResult = {
  observed: number;
  critical: number;
  iterations: number;
  stats: DistributionStats;
};

function duplicateConfig(config: ExperimentConfiguration): ExperimentConfiguration {
  return _.cloneDeep(config);
}

function getExpectedTrafficPercentage(config: ExperimentConfiguration, treatmentId: string): number {
  for (const treatment of config.treatments) {
    if (treatment.treatment_id == treatmentId) {
      if (treatment.traffic) {
        // The weight is in terms of 1000s , so dividing it by 100 to get the percentage
        return treatment.traffic.weight / 100;
      }
      return treatment.traffic_percentage ?? 0;
    }
  }

  throw new Error("getExpectedTrafficPercentage: Unreachable code reached");
}

function chiSquaredCritical(degreesOfFreedom: number, alpha = 0.001): number {
  if (alpha !== 0.001) {
    throw new Error(`unsupported alpha: ${alpha}`);
  }
  const critical = CHI_SQUARED_CRITICAL_AT_001[degreesOfFreedom];
  if (critical == null) {
    throw new Error(`unsupported degrees of freedom: ${degreesOfFreedom}`);
  }
  return critical;
}

function measureChiSquared(count: number, expConfig: ExperimentConfiguration): ChiSquaredResult {
  const config = duplicateConfig(expConfig);
  const iterations = count;
  const stats: DistributionStats = {};
  const unAssignedStats: DistributionStats = {};
  const svc = new DecisionService({ [config.experiment_id]: config });

  for (let i = 0; i < iterations; i++) {
    const [result] = svc.getExperimentDecision(
      {
        experimentId: config.experiment_id,
        seedId: uuid.v4(),
      },
      testTracer,
    );

    // Old experiments - with traffic percentage
    if (result.message && !config.traffic) {
      // for perf - 'expect' is expensive in a tight loop
      expect(result.message).toBeUndefined();
    }

    /* New Experiments - with traffic config
        If the traffic percentage is restricted, we will still assign the default treatment C with a message.
        Do not count the default treatment with active set to false as part of the Control
      */
    if (result.message && config.traffic) {
      if (!unAssignedStats[result.treatmentId]) {
        unAssignedStats[result.treatmentId] = {
          expected_percentage: 100 - config.traffic!.weight / 100,
        };
      }
      const info: Record<string, number> = unAssignedStats[result.treatmentId];
      const count = info.count ?? 0;
      info.count = count + 1;
    } else {
      if (!stats[result.treatmentId]) {
        stats[result.treatmentId] = {
          expected_percentage: getExpectedTrafficPercentage(config, result.treatmentId),
        };
      }
      const info: Record<string, number> = stats[result.treatmentId];
      const count = info.count ?? 0;

      info.count = count + 1;
    }
  }

  // Pearson ChiSquared: x^2 = Sum[ (Oi-Ei)^2 / Ei ]
  let x_squared = 0;

  const treatmentCount = config.treatment_ids.length;
  for (const [, value] of Object.entries(stats)) {
    let expectedUsers = iterations;
    // If the traffic is restricted , the expected users assigned to the experiment are based on the weight.
    if (config.traffic?.weight) {
      expectedUsers = iterations * (config.traffic.weight / 10000);
    }
    value.percentage = value.count / expectedUsers;

    const Ei = expectedUsers * (value.expected_percentage / 100.0);
    const Xi = Math.pow(value.count - Ei, 2) / Ei;
    x_squared += Xi;
  }

  const degreesOfFreedom = treatmentCount - 1;
  const critical = chiSquaredCritical(degreesOfFreedom);

  return { observed: x_squared, critical, iterations, stats };
}

// One-shot goodness-of-fit check. Family-wise CI flake target: ~0.1% per call at alpha=0.001.
function assertDistributionFair(count: number, expConfig: ExperimentConfiguration, alpha = 0.001): void {
  const { observed, critical, iterations, stats } = measureChiSquared(count, expConfig);
  const expectedCritical = chiSquaredCritical(expConfig.treatment_ids.length - 1, alpha);

  if (observed >= expectedCritical) {
    throw new Error(
      `Bucket distribution out of range: n=${iterations}, chi-squared=${observed.toFixed(4)} ` +
        `(critical=${expectedCritical} at alpha=${alpha})\n${JSON.stringify(stats, null, 2)}`,
    );
  }

  // Guard against measure/caller alpha drift during refactors.
  expect(critical).toBe(expectedCritical);
}

test("getExperimentDecision 50/50 legacy traffic split is unbiased at scale", () => {
  assertDistributionFair(100_000, DotComConfig);
});

xtest("Restricted Traffic Percentage - getExperimentDecision bucket allocation is unbiased at scale", () => {
  assertDistributionFair(100_000, DotComConfigWithTraffic);
});
