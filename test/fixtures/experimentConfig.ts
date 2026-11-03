import { ExperimentConfiguration } from "../../src/types";
import * as _ from "lodash";

export const UnpublishedExperimentFixture: ExperimentConfiguration = {
  experiment_id: "fb95d807-1c86-4ea3-9d12-3a8a3db75daa",
  treatments: [
    {
      treatment_id: "85102379-695a-4c4d-8463-20f66343647e",
      traffic_percentage: 33,
      title: "C",
      whitelist: {
        items: null,
      },
    },
    {
      treatment_id: "6fc0d6b1-fdbe-4007-bda9-e05c19592085",
      traffic_percentage: 33,
      title: "T1",
      whitelist: {
        items: null,
      },
    },
    {
      treatment_id: "3f51c5fe-c9e8-4b7c-b413-c0ecaf1bf3f5",
      traffic_percentage: 33,
      title: "T2",
      whitelist: {
        items: null,
      },
    },
  ],
  treatment_ids: [
    "85102379-695a-4c4d-8463-20f66343647e",
    "6fc0d6b1-fdbe-4007-bda9-e05c19592085",
    "3f51c5fe-c9e8-4b7c-b413-c0ecaf1bf3f5",
  ],
  experiment_type: "NON_CONTEXTUAL",
  algorithm_type: "EPSILON_FIRST",
  evaluation_order: null,
  total_enabled: true,
  is_feature: false,
  published: false,
  default_treatment: "85102379-695a-4c4d-8463-20f66343647e",
};

export const SecondExperimentFixture /*: ExperimentConfiguration */ = {
  experiment_id: "8c752ede-5e3a-4878-8ebe-e35ce515bec1",
  treatments: [
    {
      treatment_id: "9623e656-4a77-498e-8289-a62145d9bd97",
      traffic_percentage: 33,
      title: "CC",
      whitelist: {
        items: null,
      },
    },
    {
      treatment_id: "b5551d0a-2ed8-41a0-98fa-0251a52d2374",
      traffic_percentage: 33,
      title: "T11",
      whitelist: {
        items: null,
      },
    },
    {
      treatment_id: "68d04748-9766-4fe8-8236-d6e4557bdd4a",
      traffic_percentage: 33,
      title: "T22",
      whitelist: {
        items: null,
      },
    },
  ],
  treatment_ids: [
    "9623e656-4a77-498e-8289-a62145d9bd97",
    "b5551d0a-2ed8-41a0-98fa-0251a52d2374",
    "68d04748-9766-4fe8-8236-d6e4557bdd4a",
  ],
  experiment_type: "NON_CONTEXTUAL",
  algorithm_type: "EPSILON_FIRST",
  evaluation_order: null,
  total_enabled: true,
  is_feature: false,
  published: true,
  default_treatment: "9623e656-4a77-498e-8289-a62145d9bd97",
};

export const PublishedExperimentFixture: ExperimentConfiguration = (function () {
  const config = _.cloneDeep(UnpublishedExperimentFixture);
  config.published = true;
  return config;
})();

export const PublishedExperimentFixtureWithTrafficAllocation: ExperimentConfiguration = (function () {
  const config = _.cloneDeep(UnpublishedExperimentFixture);
  config.published = true;
  config.traffic = {
    weight: 10000,
  };
  config.treatments[0].traffic = {
    weight: 3300,
    allocations: [
      {
        start: 1,
        end: 3300,
      },
    ],
  };
  config.treatments[1].traffic = {
    weight: 3300,
    allocations: [
      {
        start: 3301,
        end: 6600,
      },
    ],
  };
  config.treatments[2].traffic = {
    weight: 3400,
    allocations: [
      {
        start: 6601,
        end: 10000,
      },
    ],
  };
  return config;
})();

export const PublishedExperimentFixtureWithPercentageTraffic: ExperimentConfiguration = (function () {
  const config = _.cloneDeep(UnpublishedExperimentFixture);
  config.published = true;
  config.traffic = {
    weight: 3000,
  };
  config.treatments[0].traffic = {
    weight: 3300,
    allocations: [
      {
        start: 1,
        end: 990,
      },
    ],
  };
  config.treatments[1].traffic = {
    weight: 3300,
    allocations: [
      {
        start: 991,
        end: 1980,
      },
    ],
  };
  config.treatments[2].traffic = {
    weight: 3400,
    allocations: [
      {
        start: 1981,
        end: 3000,
      },
    ],
  };
  return config;
})();

export const PublishedExperimentFixtureInMEG: ExperimentConfiguration = (function () {
  const config = _.cloneDeep(PublishedExperimentFixtureWithTrafficAllocation);
  config.published = true;
  config.group_id = "fb95d807-1c86-4ea3-12345";
  config.traffic = {
    weight: 3000,
    allocations: [
      {
        start: 1,
        end: 3000,
      },
    ],
  };
  return config;
})();

export const PublishedExperimentRampUpWithPolicyGroupFixture: ExperimentConfiguration = (function () {
  const config = _.cloneDeep(UnpublishedExperimentFixture);
  config.published = true;
  config.traffic = {
    weight: 10000,
  };
  return _.merge(config, {
    policy_groups: [
      {
        policy_id: "b0ede6d1-f52f-4aad-952b-111111111",
        name: "hold-out",
        override_seed_id: "SEED_ID",
        traffic: {
          weight: 1000,
          allocations: [
            {
              start: 1,
              end: 100,
            },
            {
              start: 1001,
              end: 1900,
            },
          ],
        },
        treatment_allocations: [
          {
            treatment_id: "85102379-695a-4c4d-8463-20f66343647e",
            traffic: {
              weight: 5000,
            },
          },
          {
            treatment_id: "6fc0d6b1-fdbe-4007-bda9-e05c19592085",
            traffic: {
              weight: 5000,
            },
          },
        ],
      },
      {
        policy_id: "b0ede6d1-f52f-4aad-952b-222222222",
        name: "TS",
        override_seed_id: "SESSION_ID",
        traffic: {
          weight: 9000,
          allocations: [
            {
              start: 101,
              end: 1000,
            },
            {
              start: 1901,
              end: 10000,
            },
          ],
        },
        treatment_allocations: [
          {
            treatment_id: "85102379-695a-4c4d-8463-20f66343647e",
            traffic: {
              weight: 5000,
            },
          },
          {
            treatment_id: "6fc0d6b1-fdbe-4007-bda9-e05c19592085",
            traffic: {
              weight: 5000,
            },
          },
        ],
      },
    ],
  });
})();

export const PublishedExperimentWithPolicyGroupFixture: ExperimentConfiguration = (function () {
  const config = _.cloneDeep(UnpublishedExperimentFixture);
  config.published = true;
  config.traffic = {
    weight: 1000,
  };
  return _.merge(config, {
    policy_groups: [
      {
        policy_id: "b0ede6d1-f52f-4aad-952b-111111111",
        name: "hold-out",
        override_seed_id: "SEED_ID",
        traffic: {
          weight: 1000,
          allocations: [
            {
              start: 1,
              end: 100,
            },
          ],
        },
        treatment_allocations: [
          {
            treatment_id: "85102379-695a-4c4d-8463-20f66343647e",
            traffic: {
              weight: 5000,
            },
          },
          {
            treatment_id: "6fc0d6b1-fdbe-4007-bda9-e05c19592085",
            traffic: {
              weight: 5000,
            },
          },
        ],
      },
      {
        policy_id: "b0ede6d1-f52f-4aad-952b-222222222",
        name: "TS",
        override_seed_id: "SESSION_ID",
        traffic: {
          weight: 9000,
          allocations: [
            {
              start: 101,
              end: 1000,
            },
          ],
        },
        treatment_allocations: [
          {
            treatment_id: "85102379-695a-4c4d-8463-20f66343647e",
            traffic: {
              weight: 5000,
            },
          },
          {
            treatment_id: "6fc0d6b1-fdbe-4007-bda9-e05c19592085",
            traffic: {
              weight: 5000,
            },
          },
        ],
      },
    ],
  });
})();

export const PublishedExperimentWithAudienceFixture: ExperimentConfiguration = (function () {
  const config = _.cloneDeep(UnpublishedExperimentFixture);
  config.published = true;
  return _.merge(config, {
    num_of_unique_ctx_in_audience: 2,
    audience_group: [
      {
        name: "SUB_PLAN_PICKER_US_WEB_ONLY",
        value: {
          country: ["us"],
          platform: ["WEB"],
        },
      },
    ],
  });
})();
