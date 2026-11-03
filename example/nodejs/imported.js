import console from "console";
import * as Labs from "../../dist/labs-sdk-dev.js";

import { PublishedExperimentFixture } from "../fixtures.js";

///////////////////////////////////////

const sdkConfig = {
  // Internet:
  // trackUrl: "https://prd.api.discomax.com/labs/api/v1/decision/track",
  // trackUrl: "https://stg.api.discomax.com/labs/api/v1/decision/track",
  // trackUrl: "https://int.api.discomax.com/labs/api/v1/decision/track",
  trackUrl: "https://dev.api.discomax.com/labs/api/v1/decision/track",

  // in-cluster:
  // http://labs-decision-api-web-microservice.labs-decision-api.svc.cluster.local:8000/api/v1/decision/track

  experimentId: PublishedExperimentFixture.experiment_id,
}

const sdk = Labs.NewSDK(sdkConfig, PublishedExperimentFixture)

console.log(`SDK Loaded: Version: ${Labs.getSDKVersion()}`)

// Use `npm run start`
console.log(
  sdk.getDecision(
    {
      experiment_id: 'EmptyExperiment',
      treatments: [],
      treatment_ids: [],
      experiment_type: '',
      algorithm_type: '',
      evaluation_order: undefined,
      total_enabled: false,
      is_feature: false,
      published: true,
      audience_group: [],
      num_of_unique_ctx_in_audience: 0,
      default_treatment: '',
    },
    { seedId: 'foobar', experimentId: 'EmptyExperiment' }
  )
);

let decision = sdk.getDecision({
  seedId: 'WithContext',
  experimentId: PublishedExperimentFixture.experiment_id,
  context: {
    sessionId: "MySessionId-FromNodeJS",
    deviceType: "Best Device Ever"
  }
})
decision = sdk.getDecision({
  seedId: 'MissingContext',
  experimentId: PublishedExperimentFixture.experiment_id,
})
console.log("Decision:", decision)
