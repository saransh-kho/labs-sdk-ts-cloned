import * as sdk from "../src/sdk";
import {
  SDKConfig,
  LabsSDK,
  ExperimentConfigurations,
  DecisionResponseDeferredTracker,
  UserContext,
  DecisionRequest,
} from "../src/types";
import { PublishedExperimentFixture } from "./fixtures/experimentConfig";

const PublishedExpId = PublishedExperimentFixture.experiment_id;

export function getAnSDK(experiments: ExperimentConfigurations | null): LabsSDK {
  if (experiments === null) {
    experiments = [PublishedExperimentFixture];
  }

  const experimentIds: string[] = [];
  for (const experiment of experiments) {
    experimentIds.push(experiment.experiment_id);
  }

  const sdkConfig: SDKConfig = {
    fetchUrl: "/exp/config",
    trackUrl: "/track",
    experimentIds: experimentIds,
  };

  const initializedSDK = sdk.NewSDK(sdkConfig, experiments);
  return initializedSDK;
}

export function getDeferredDecisionFromSDK(context?: UserContext): DecisionResponseDeferredTracker {
  const initializedSDK = getAnSDK(null);
  const request: DecisionRequest = {
    experimentId: PublishedExpId,
    seedId: "SomeSeed",
  };
  if (context) {
    request.context = context;
  }

  const decisionResponse = initializedSDK.getDeferredDecision(request);

  // Basic validation that we got a valid decision response
  expect(decisionResponse.decision).toMatchObject({
    experimentId: PublishedExpId,
    status: "success",
    active: expect.any(Boolean),
    control: expect.any(Boolean),
    label: expect.any(String),
    treatmentId: expect.any(String),
  });

  return decisionResponse;
}

// Helper function to wait for conditions - useful for async operations in tests
export async function waitFor(condition: () => boolean, timeout = 1000, interval = 10): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`Condition not met within ${timeout}ms`);
}
