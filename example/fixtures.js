function cloneDeep(obj) { return JSON.parse(JSON.stringify(obj)) }

export const ExampleExperimentFixture = {
    "experiment_id": "4d9bad2a-a844-414c-8bcf-e17726e73ada",
    "treatments": [
        {
            "treatment_id": "b0ede6d1-f52f-4aad-952b-1ba9ae12c412",
            "traffic_percentage": 50,
            "title": "C",
            "whitelist": {
                "items": null
            }
        },
        {
            "treatment_id": "a5e70473-efea-438c-ba57-f63e809200cd",
            "traffic_percentage": 50,
            "title": "T1",
            "whitelist": {
                "items": null
            }
        }
    ],
    "treatment_ids": [
        "b0ede6d1-f52f-4aad-952b-1ba9ae12c412",
        "a5e70473-efea-438c-ba57-f63e809200cd"
    ],
    "experiment_type": "NON_CONTEXTUAL",
    "algorithm_type": "EPSILON_FIRST",
    "evaluation_order": null,
    "total_enabled": true,
    "is_feature": false,
    "published": false,
    "audience_group": null,
    "num_of_unique_ctx_in_audience": 0,
    "default_treatment": "b0ede6d1-f52f-4aad-952b-1ba9ae12c412"
}

export const UnpublishedExperimentFixture /*: ExperimentConfiguration */ = {
    experiment_id: "4a785656-e892-41f5-b669-0f3c61d355d0",
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

export const PublishedExperimentFixture /*: ExperimentConfiguration */ = (function () {
    const config = cloneDeep(UnpublishedExperimentFixture);
    config.published = true;
    return config;
})();

export const PublishedExperimentWithAudienceFixture /*: ExperimentConfiguration */ =
    (function () {
        const config = cloneDeep(UnpublishedExperimentFixture);
        config.published = true;
        return {
            ...config, ...{
                num_of_unique_ctx_in_audience: 2,
                audience_group: [
                  {
                    name: "JSONLogic Audience Test",
                    value: null,
                    query: "{\"or\":[{\"and\":[{\"icase_compare\":[\"==\",{\"var\":\"platform\"},\"ios\"]},{\"semver_cmp\":[\">=\",{\"var\":\"appVersion\"},\"18.6\"]}]},{\"and\":[{\"icase_compare\":[\"==\",{\"var\":\"platform\"},\"android\"]},{\"semver_cmp\":[\">=\",{\"var\":\"appVersion\"},\"14\"]}]}]}"
                  }
                ],
            }
        };
    })();
