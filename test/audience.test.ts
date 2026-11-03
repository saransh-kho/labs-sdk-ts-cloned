import * as _ from "lodash";
import { _internalAudienceService as AudienceService } from "../src/audience";
import {
  AudienceGroup,
  ExperimentConfiguration,
  LabsTraceFields,
  LabsTraceLevel,
  Treatment,
} from "../src/types";
import { PublishedExperimentFixture } from "./fixtures/experimentConfig";
import { _InternalDecisionTracer } from "../src";

function getEmptyConfig(insert?: Partial<ExperimentConfiguration>): ExperimentConfiguration {
  return _.merge(
    {
      experiment_id: "EmptyExperiment",
      treatments: [],
      treatment_ids: [],
      experiment_type: "",
      algorithm_type: "",
      evaluation_order: undefined,
      total_enabled: false,
      is_feature: false,
      published: false,
      audience_group: [],
      num_of_unique_ctx_in_audience: 0,
      default_treatment: "",
    },
    insert,
  );
}

class Tracer implements _InternalDecisionTracer {
  traceId: string = "";
  LogMessages: {
    message: string;
    id: string;
    fields: LabsTraceFields;
    level: LabsTraceLevel;
  }[] = [];

  trace(level: LabsTraceLevel, id: string, message: string, fields: LabsTraceFields): void {
    this.LogMessages.push({
      level,
      id,
      message,
      fields,
    });
    // console.log(`[${level}] [${id}] ${message}`, fields);
  }
}

function getAudienceService(config: ExperimentConfiguration): [AudienceService, Tracer] {
  const tracer = new Tracer();
  const audience = new AudienceService(config, tracer);
  return [audience, tracer];
}

function getTestAudience(append?: AudienceGroup): Partial<ExperimentConfiguration> {
  const audience_group: AudienceGroup = [
    {
      name: "My favorite rule",
      value: {
        color: ["blue", "purple"],
        country: ["us"],
      },
    },
    {
      name: "Another Rule",
      value: {
        device: ["ios"],
        color: ["red", "purple"],
      },
    },
  ];
  return {
    audience_group: _.concat(audience_group, append ?? []),
  };
}

function getDefaultAllowList(append?: Partial<Treatment>[]): Partial<Treatment>[] {
  const allowList: Partial<Treatment>[] = _.concat(
    [
      {
        whitelist: {
          items: {
            profileId: {
              values: ["joe"],
            },
          },
        },
      },
    ],
    append ?? [],
  );

  return allowList;
}

describe("Test audience service IsRequestSatisfied", () => {
  test("Simple audience validation", () => {
    const context = {
      device: "ios",
      country: "us",
      color: "red, green, purple",
    };

    const config = getEmptyConfig(getTestAudience());
    const [service] = getAudienceService(config);

    const result = service.isRequestSatisfied(context);
    expect(result).toBeTruthy();
  });

  test("Partial matches fail", () => {
    // this context matches the first rule, but not the second.
    // It also matches at least 1 value in each rule (us, and ios)
    const context = {
      device: "ios",
      country: "us",
      color: "blue",
    };

    const config = getEmptyConfig(getTestAudience());
    const [service] = getAudienceService(config);

    const result = service.isRequestSatisfied(context);
    expect(result).toBeFalsy();
  });
});

describe("Test audience service decisionFromAllowList", () => {
  test("Basic AllowList matching validation", () => {
    // put into 2nd slot to make sure the default control
    // treatment doesn't come back.
    const allowList = [undefined, ...getDefaultAllowList()];
    const config = _.cloneDeep(PublishedExperimentFixture);
    _.merge(config.treatments, allowList);

    const context = {
      profileId: ["sam", "Joe"],
    };

    const [service] = getAudienceService(config);

    const result = service.treatmentFromAllowList(context);

    const expected: Partial<Treatment> = {
      title: "T1",
      traffic_percentage: 33,
      treatment_id: "6fc0d6b1-fdbe-4007-bda9-e05c19592085",
    };
    expect(result).toEqual(expect.objectContaining(expected));
  });

  test("Basic AllowList matching validation with Op set", () => {
    const allowList = [undefined, ...getDefaultAllowList()];
    const value = allowList[1]?.whitelist?.items?.profileId;
    expect(value).toBeDefined();
    value!.op = "eq";
    const config = _.cloneDeep(PublishedExperimentFixture);
    _.merge(config.treatments, allowList);

    const context = {
      profileId: "sam, joe",
    };

    _.merge(config.treatments, allowList);
    const [service] = getAudienceService(config);

    const result = service.treatmentFromAllowList(context);
    const expected: Partial<Treatment> = {
      title: "T1",
      traffic_percentage: 33,
      treatment_id: "6fc0d6b1-fdbe-4007-bda9-e05c19592085",
    };
    expect(result).toEqual(expect.objectContaining(expected));
  });
});

describe("JSONLogic Query Support", () => {
  test("should satisfy audience rules with JSONLogic queries", () => {
    const audience_group: AudienceGroup = [
      {
        name: "Platform Query Rule",
        value: {},
        query: '{"and": [{"==": [{"var": "platform"}, "ios"]}]}',
      },
    ];
    const config = getEmptyConfig({ audience_group });
    const [service, tracer] = getAudienceService(config);

    const context = {
      platform: "ios",
    };

    const result = service.isRequestSatisfied(context);
    expect(result).toBeTruthy();

    // Check that JSONLogic was used
    const jsonLogicMessages = tracer.LogMessages.filter((msg) => msg.id === "AUDIENCE_JSONLOGIC_SUCCESS");
    expect(jsonLogicMessages.length).toBeGreaterThan(0);
  });

  test("should fail audience rules with JSONLogic queries when condition not met", () => {
    const audience_group: AudienceGroup = [
      {
        name: "Platform Query Rule",
        value: {},
        query: '{"and": [{"==": [{"var": "platform"}, "android"]}]}',
      },
    ];
    const config = getEmptyConfig({ audience_group });
    const [service, tracer] = getAudienceService(config);

    const context = {
      platform: "ios",
    };

    const result = service.isRequestSatisfied(context);
    expect(result).toBeFalsy();

    // Check that JSONLogic failure was logged
    const jsonLogicMessages = tracer.LogMessages.filter((msg) => msg.id === "AUDIENCE_JSONLOGIC_FAIL");
    expect(jsonLogicMessages.length).toBeGreaterThan(0);
  });

  test("should handle complex JSONLogic queries with multiple conditions", () => {
    const audience_group: AudienceGroup = [
      {
        name: "Complex Query Rule",
        value: {},
        query: '{"and": [{"==": [{"var": "platform"}, "ios"]}, {">=": [{"var": "version"}, "1.0"]}]}',
      },
    ];
    const config = getEmptyConfig({ audience_group });
    const [service] = getAudienceService(config);

    const context = {
      platform: "ios",
      version: "2.0",
    };

    const result = service.isRequestSatisfied(context);
    expect(result).toBeTruthy();
  });

  test("should require both query and value to pass when both are present", () => {
    // Go parity: a query and value on the same audience are AND'd together;
    // the query does NOT override the value. Here the query passes but the
    // value fails, so the overall result must be false.
    const audience_group: AudienceGroup = [
      {
        name: "Mixed Rule",
        value: { platform: ["android"] }, // fails for ios
        query: '{"and": [{"==": [{"var": "platform"}, "ios"]}]}', // passes
      },
    ];
    const [service] = getAudienceService(getEmptyConfig({ audience_group }));
    expect(service.isRequestSatisfied({ platform: "ios" })).toBeFalsy();

    // When both the query and the value pass, the audience is satisfied.
    const bothPass: AudienceGroup = [
      {
        name: "Mixed Rule",
        value: { platform: ["ios"] },
        query: '{"and": [{"==": [{"var": "platform"}, "ios"]}]}',
      },
    ];
    const [service2] = getAudienceService(getEmptyConfig({ audience_group: bothPass }));
    expect(service2.isRequestSatisfied({ platform: "ios" })).toBeTruthy();
  });

  test("should handle malformed JSON in query gracefully", () => {
    const audience_group: AudienceGroup = [
      {
        name: "Malformed Query Rule",
        value: {},
        query: '{"invalid": json}', // Invalid JSON
      },
    ];
    const config = getEmptyConfig({ audience_group });
    const [service, tracer] = getAudienceService(config);

    const context = {
      platform: "ios",
    };

    const result = service.isRequestSatisfied(context);
    expect(result).toBeFalsy();

    // Check that exception was logged (may be JSONLOGIC_ERROR or JSONLOGIC_EXCEPTION)
    const errorMessages = tracer.LogMessages.filter(
      (msg) => msg.id === "AUDIENCE_JSONLOGIC_EXCEPTION" || msg.id === "AUDIENCE_JSONLOGIC_ERROR",
    );
    expect(errorMessages.length).toBeGreaterThan(0);
  });

  test("should handle invalid JSONLogic query gracefully", () => {
    const audience_group: AudienceGroup = [
      {
        name: "Invalid Query Rule",
        value: {},
        query: '{"invalid": "jsonlogic"}',
      },
    ];
    const config = getEmptyConfig({ audience_group });
    const [service, tracer] = getAudienceService(config);

    const context = {
      platform: "ios",
    };

    const result = service.isRequestSatisfied(context);
    expect(result).toBeFalsy();

    // Check that error was logged
    const errorMessages = tracer.LogMessages.filter((msg) => msg.id === "AUDIENCE_JSONLOGIC_ERROR");
    expect(errorMessages.length).toBeGreaterThan(0);
  });

  test("should handle JSONLogic query returning unexpected values", () => {
    const audience_group: AudienceGroup = [
      {
        name: "Unexpected Result Rule",
        value: {},
        query: '{"var": "nonexistent"}', // This might return null/undefined
      },
    ];
    const config = getEmptyConfig({ audience_group });
    const [service, tracer] = getAudienceService(config);

    const context = {
      platform: "ios",
    };

    const result = service.isRequestSatisfied(context);
    expect(result).toBeFalsy();

    // Should log an error for unexpected result (may be JSONLOGIC_ERROR or JSONLOGIC_FAIL)
    const errorMessages = tracer.LogMessages.filter(
      (msg) => msg.id === "AUDIENCE_JSONLOGIC_ERROR" || msg.id === "AUDIENCE_JSONLOGIC_FAIL",
    );
    expect(errorMessages.length).toBeGreaterThan(0);
  });
});

describe("Enhanced Audience Validation", () => {
  test("should handle empty audience_group array", () => {
    const config = getEmptyConfig({ audience_group: [] });
    const [service, tracer] = getAudienceService(config);

    const result = service.isRequestSatisfied({ platform: "ios" });
    expect(result).toBeTruthy();

    // Should log no restrictions message
    const noRestrictionsMessages = tracer.LogMessages.filter((msg) => msg.id === "AUDIENCE_NO_RESRICTIONS");
    expect(noRestrictionsMessages.length).toBeGreaterThan(0);
  });

  test("should handle empty context object when audience rules exist", () => {
    const config = getEmptyConfig(getTestAudience());
    const [service, tracer] = getAudienceService(config);

    const result = service.isRequestSatisfied({});
    expect(result).toBeFalsy();

    // Should log no context message
    const noContextMessages = tracer.LogMessages.filter((msg) => msg.id === "AUDIENCE_NO_CONTEXT");
    expect(noContextMessages.length).toBeGreaterThan(0);
  });

  test("an empty context still satisfies a NOT condition, as in Go", () => {
    const config = getEmptyConfig({
      audience_group: [{ name: "Not horizonos", value: { platform: ["!horizonos"] } }],
    });
    const [service] = getAudienceService(config);

    expect(service.isRequestSatisfied({})).toBeTruthy();
  });

  test("should trace all evaluations even when early failure occurs", () => {
    const audience_group: AudienceGroup = [
      {
        name: "First Rule",
        value: { platform: ["android"] }, // This will fail
      },
      {
        name: "Second Rule",
        value: { country: ["us"] }, // This would pass but shouldn't be evaluated
      },
    ];
    const config = getEmptyConfig({ audience_group });
    const [service, tracer] = getAudienceService(config);

    const context = {
      platform: "ios",
      country: "us",
    };

    const result = service.isRequestSatisfied(context);
    expect(result).toBeFalsy();

    // Should have trace messages for both rules
    const failMessages = tracer.LogMessages.filter((msg) => msg.id === "AUDIENCE_FAIL");
    expect(failMessages.length).toBeGreaterThan(0);
  });

  test("should handle case-insensitive matching", () => {
    const audience_group: AudienceGroup = [
      {
        name: "Case Insensitive Rule",
        value: { platform: ["iOS", "ANDROID"] },
      },
    ];
    const config = getEmptyConfig({ audience_group });
    const [service] = getAudienceService(config);

    const context = {
      platform: "ios",
    };

    const result = service.isRequestSatisfied(context);
    expect(result).toBeTruthy();
  });

  test("should handle comma-separated string values", () => {
    const audience_group: AudienceGroup = [
      {
        name: "Comma Separated Rule",
        value: { colors: ["red", "blue"] },
      },
    ];
    const config = getEmptyConfig({ audience_group });
    const [service] = getAudienceService(config);

    const context = {
      colors: "red, yellow, green",
    };

    const result = service.isRequestSatisfied(context);
    expect(result).toBeTruthy();
  });

  test("should handle array context values", () => {
    const audience_group: AudienceGroup = [
      {
        name: "Array Rule",
        value: { colors: ["red", "blue"] },
      },
    ];
    const config = getEmptyConfig({ audience_group });
    const [service] = getAudienceService(config);

    const context = {
      colors: ["red", "yellow"],
    };

    const result = service.isRequestSatisfied(context);
    expect(result).toBeTruthy();
  });
});

describe("Enhanced AllowList Testing", () => {
  test("should handle treatments without whitelist", () => {
    const treatments: Treatment[] = [
      {
        treatment_id: "test-id",
        traffic_percentage: 100,
        title: "Test Treatment",
      },
    ];
    const config = getEmptyConfig({ treatments });
    const [service] = getAudienceService(config);

    const result = service.treatmentFromAllowList({ profileId: "test" });
    expect(result).toBeUndefined();
  });

  test("should handle treatments with empty whitelist items", () => {
    const treatments: Treatment[] = [
      {
        treatment_id: "test-id",
        traffic_percentage: 100,
        title: "Test Treatment",
        whitelist: {
          items: {},
        },
      },
    ];
    const config = getEmptyConfig({ treatments });
    const [service] = getAudienceService(config);

    const result = service.treatmentFromAllowList({ profileId: "test" });
    expect(result).toBeUndefined();
  });

  test("should require all whitelist items to match", () => {
    const treatments: Treatment[] = [
      {
        treatment_id: "test-id",
        traffic_percentage: 100,
        title: "Test Treatment",
        whitelist: {
          items: {
            profileId: {
              values: ["test"],
            },
            country: {
              values: ["us"],
            },
          },
        },
      },
    ];
    const config = getEmptyConfig({ treatments });
    const [service] = getAudienceService(config);

    // Should match
    const result1 = service.treatmentFromAllowList({
      profileId: "test",
      country: "us",
    });
    expect(result1).toBeDefined();

    // Should not match (missing country)
    const result2 = service.treatmentFromAllowList({
      profileId: "test",
    });
    expect(result2).toBeUndefined();
  });

  test("should handle case-insensitive matching in allow list", () => {
    const treatments: Treatment[] = [
      {
        treatment_id: "test-id",
        traffic_percentage: 100,
        title: "Test Treatment",
        whitelist: {
          items: {
            profileId: {
              values: ["TEST"],
            },
          },
        },
      },
    ];
    const config = getEmptyConfig({ treatments });
    const [service] = getAudienceService(config);

    const result = service.treatmentFromAllowList({ profileId: "test" });
    expect(result).toBeDefined();
  });

  test("should handle comma-separated string values in allow list", () => {
    const treatments: Treatment[] = [
      {
        treatment_id: "test-id",
        traffic_percentage: 100,
        title: "Test Treatment",
        whitelist: {
          items: {
            profileId: {
              values: ["test"],
            },
          },
        },
      },
    ];
    const config = getEmptyConfig({ treatments });
    const [service] = getAudienceService(config);

    const result = service.treatmentFromAllowList({ profileId: "test, other" });
    expect(result).toBeDefined();
  });

  test("should handle array values in allow list", () => {
    const treatments: Treatment[] = [
      {
        treatment_id: "test-id",
        traffic_percentage: 100,
        title: "Test Treatment",
        whitelist: {
          items: {
            profileId: {
              values: ["test"],
            },
          },
        },
      },
    ];
    const config = getEmptyConfig({ treatments });
    const [service] = getAudienceService(config);

    const result = service.treatmentFromAllowList({ profileId: ["test", "other"] });
    expect(result).toBeDefined();
  });
});

describe("Handles edge cases errors", () => {
  test("isRequestSatisfied with undefined audience and context", () => {
    const config = getEmptyConfig();
    const [service] = getAudienceService(config);

    // Doesn't throw/crash
    expect(service.isRequestSatisfied(undefined)).toBeTruthy();
    expect(service._contextSatisfiesAllowListItem(undefined, undefined)).toBeFalsy();
  });

  test("isRequestSatisfied with audience and undefined context", () => {
    const config = getEmptyConfig(getTestAudience());
    const [service] = getAudienceService(config);

    // Doesn't throw/crash
    expect(service.isRequestSatisfied(undefined)).toBeFalsy();
  });
  test("isRequestSatisfied with undefined context key", () => {
    const config = getEmptyConfig(getTestAudience());
    const [service] = getAudienceService(config);

    // Doesn't throw/crash
    expect(service.isRequestSatisfied({ colour: "fuchsia" })).toBeFalsy();
  });

  test("decisionFromAllowList handled missing whitelist.items field", () => {
    const allowList: Partial<Treatment> = { whitelist: {} };
    const config = getEmptyConfig();
    _.merge(config.treatments, [allowList]);

    const [service] = getAudienceService(config);

    const result = service.treatmentFromAllowList({});
    expect(result).toBeUndefined();
  });

  test("should handle null context values gracefully", () => {
    const audience_group: AudienceGroup = [
      {
        name: "Test Rule",
        value: { platform: ["ios"] },
      },
    ];
    const config = getEmptyConfig({ audience_group });
    const [service] = getAudienceService(config);

    const context = {
      platform: null as any,
    };

    const result = service.isRequestSatisfied(context);
    expect(result).toBeFalsy();
  });

  test("should handle empty string context values", () => {
    const audience_group: AudienceGroup = [
      {
        name: "Test Rule",
        value: { platform: ["ios"] },
      },
    ];
    const config = getEmptyConfig({ audience_group });
    const [service] = getAudienceService(config);

    const context = {
      platform: "",
    };

    const result = service.isRequestSatisfied(context);
    expect(result).toBeFalsy();
  });

  test("should handle whitespace-only context values", () => {
    const audience_group: AudienceGroup = [
      {
        name: "Test Rule",
        value: { platform: ["ios"] },
      },
    ];
    const config = getEmptyConfig({ audience_group });
    const [service] = getAudienceService(config);

    const context = {
      platform: "   ",
    };

    const result = service.isRequestSatisfied(context);
    expect(result).toBeFalsy();
  });

  test("should handle audience rules with empty value objects", () => {
    const audience_group: AudienceGroup = [
      {
        name: "Empty Rule",
        value: {},
      },
    ];
    const config = getEmptyConfig({ audience_group });
    const [service] = getAudienceService(config);

    const context = {
      platform: "ios",
    };

    const result = service.isRequestSatisfied(context);
    expect(result).toBeTruthy(); // Empty value object should be satisfied
  });

  test("should handle audience rules with null value without crashing", () => {
    const audience_group: AudienceGroup = [
      {
        name: "Null Rule",
        value: null as any,
      },
    ];
    const config = getEmptyConfig({ audience_group });
    const [service] = getAudienceService(config);

    const context = {
      platform: "ios",
    };

    // A null/absent value map is now handled gracefully (Go parity: an audience
    // with no value conditions and no query imposes no constraint).
    let result: boolean | undefined;
    expect(() => {
      result = service.isRequestSatisfied(context);
    }).not.toThrow();
    expect(result).toBeTruthy();
  });
});

describe("Audience value-path operator grammar (Go parity)", () => {
  function check(value: Record<string, string[]>, context: Record<string, string>): boolean {
    const audience_group: AudienceGroup = [{ name: "Grammar Rule", value }];
    const [service] = getAudienceService(getEmptyConfig({ audience_group }));
    return service.isRequestSatisfied(context);
  }

  test("relational semver: >= includes equal and higher, excludes lower", () => {
    expect(check({ appVersion: [">=7.2.0"] }, { appVersion: "7.3.1" })).toBe(true);
    expect(check({ appVersion: [">=7.2.0"] }, { appVersion: "7.2.0" })).toBe(true);
    expect(check({ appVersion: [">=7.2.0"] }, { appVersion: "7.1.9" })).toBe(false);
  });

  test("relational semver: strict > excludes equal", () => {
    expect(check({ appVersion: [">7.2.0"] }, { appVersion: "7.2.0" })).toBe(false);
    expect(check({ appVersion: [">7.2.0"] }, { appVersion: "7.2.1" })).toBe(true);
  });

  test("relational semver: < and <= with abbreviated versions", () => {
    expect(check({ appVersion: ["<3"] }, { appVersion: "2.9.9" })).toBe(true);
    expect(check({ appVersion: ["<=3.0.0"] }, { appVersion: "3.0.0" })).toBe(true);
    expect(check({ appVersion: ["<3"] }, { appVersion: "3.0.1" })).toBe(false);
  });

  test("plain value stays exact (no implicit semver)", () => {
    expect(check({ appVersion: ["7.2.0"] }, { appVersion: "7.3.1" })).toBe(false);
    expect(check({ appVersion: ["7.2.0"] }, { appVersion: "7.2.0" })).toBe(true);
  });

  test("negation: !value matches anything else", () => {
    expect(check({ platform: ["!xbox"] }, { platform: "ios" })).toBe(true);
    expect(check({ platform: ["!xbox"] }, { platform: "xbox" })).toBe(false);
  });

  test("default OR within a field's condition list", () => {
    expect(check({ platform: ["ios", "android"] }, { platform: "android" })).toBe(true);
    expect(check({ platform: ["ios", "android"] }, { platform: "roku" })).toBe(false);
  });

  test("any negation flips the field's list to AND", () => {
    // not xbox AND not roku
    expect(check({ platform: ["!xbox", "!roku"] }, { platform: "ios" })).toBe(true);
    expect(check({ platform: ["!xbox", "!roku"] }, { platform: "roku" })).toBe(false);
  });

  test("comma-separated context tokens can satisfy a condition", () => {
    expect(check({ segment: ["beta"] }, { segment: "alpha,beta,gamma" })).toBe(true);
    expect(check({ segment: ["delta"] }, { segment: "alpha,beta,gamma" })).toBe(false);
  });

  test("equality is case-insensitive", () => {
    expect(check({ platform: ["IOS"] }, { platform: "ios" })).toBe(true);
  });
});
