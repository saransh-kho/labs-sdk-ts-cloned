import { _InternalDecisionTracer } from "./sdk";
import {
  AllowListItems,
  AllowListValue,
  AudienceGroup,
  ContextValue,
  ExperimentConfiguration,
  LabsTraceLevel as TraceLevel,
  Treatment,
  UserContext,
} from "./types";
import { applyJsonLogicWithCustomOperators } from "./internal/query";
import { semverCompare } from "./internal/semver";

export type TraceFn = (
  level: TraceLevel,
  id: string,
  message: string,
  fields: Record<string, unknown>,
) => void;

class AudienceService {
  // trace is bounce to the caller's tracer for consistant usage
  _trace: _InternalDecisionTracer["trace"];
  constructor(
    private config: ExperimentConfiguration,
    tracer: _InternalDecisionTracer,
  ) {
    this._trace = tracer.trace.bind(tracer);
  }

  private trace(level: TraceLevel, id: string, message: string, fields: Record<string, unknown>): void {
    const extendedFields = { ...fields, source: "AudienceService" };
    this._trace(level, `AUDIENCE_${id}`, message, extendedFields);
  }

  // For every top level element in the audience group, each and every one
  // must evaluate to true. (&& clauses)
  // Inside each audience is another set of elements only 1 of which need
  // be true. (|| clauses)
  // As an example:
  //    context = {
  //      platform: "ios",
  //      appVersion: "18.6.1",
  //      country: "us",
  //      color: "red, blue",
  //      cat: "persian",
  //    };

  //    audiences: AudienceGroup = [
  //      {
  //        name: "My Favorite Rule",
  //        value: {
  //          color: ["blue", "purple"],
  //          country: ["us"],
  //        },
  //      },
  //      {
  //        name: "Another Rule",
  //        value: {
  //          platform: ["ios"],
  //          color: ["red"],
  //        },
  //      },
  //      {
  //        name: "Rule with Query",
  //        value: null,
  //        query: "{
  //          \"and\": [
  //            { \"icase_compare\": [ \"==\", { \"var\": \"platform\" }, \"ios\" ] },
  //            { \"semver_cmp\": [ \">=\", { \"var\": \"appVersion\" }, \"18.6\" ] }
  //          ]
  //        }",
  //      }
  //    ];
  // Expected: True. Why?  Both "My Favorite Rule", "Another Rule" and "Rule with Query" must be satisfied.
  // Within 'My Favorite Rule', the user context values 'blue' and 'us' satisfy the color/country requirements.
  // On the second 'Another Rule', 'red' and 'ios' satisfy the color and platform requirements.
  // Finally, with the third 'Rule with Query', the jsonlogic query (after JSON parsing) is evaluated.
  // The platform is 'ios' and the appVersion '18.6.1' is >= '18.6' thus satisfying the rule.
  // All three audience rules are satisfied, so the overall result is true.
  public isRequestSatisfied(context?: UserContext): boolean {
    return isAudienceGroupSatisfied(this.config.audience_group, context, this.trace.bind(this));
  }

  _contextSatisfiesAllowListItem(contextValue?: ContextValue, value?: AllowListValue): boolean {
    return contextSatisfiesAllowListItem(contextValue, value);
  }

  // If the seed/user matches an Allow-Listed treatment, return it
  public treatmentFromAllowList(context?: UserContext): Treatment | undefined {
    return findAllowListMatch(this.config.treatments, context, this._trace);
  }
}

// Extracted so flag targeting rules (which run audience checks against many
// different AudienceGroup values per decision - flag-level plus one per
// targeting rule - rather than one fixed ExperimentConfiguration) can reuse
// this exact grammar/logic without constructing a throwaway
// ExperimentConfiguration shim. AudienceService.isRequestSatisfied is now a
// one-line delegator to this function, unchanged in behavior/trace output.
export function isAudienceGroupSatisfied(
  audiences: AudienceGroup | undefined,
  context: UserContext | undefined,
  trace: TraceFn,
): boolean {
  trace(TraceLevel.DEBUG, "ENTERING", "isRequestSatisfied()", { audiences, context });

  if (!Array.isArray(audiences) || audiences.length === 0) {
    trace(TraceLevel.INFO, "NO_RESRICTIONS", "No audience rules defined.  Satisfied.", {});
    return true;
  }

  // Not a failure on its own: as in Go, a missing key reads as empty, which a
  // NOT condition such as "!horizonos" still satisfies
  if (!context || Object.keys(context).length === 0) {
    trace(
      TraceLevel.WARN,
      "NO_CONTEXT",
      "Has audience rules, but no context to match. Every key reads as empty.",
      {
        audiences,
        context, // empty
      },
    );
    context = {};
  }

  // Walk each audience requirement and make sure it is satisfied.
  // If any fail, DON'T short circuit and bail. Do all evaluations
  // for traceability even if we already know the answer.

  // every rule with a name and value keys must satisfy.  First iteration,
  // name === "my favorite rule"

  let satisfied = true; // until otherwise...
  for (const audience of audiences) {
    // Accumulate overall satisfaction across audiences and rules

    // A jsonlogic query and value-based conditions can both be present on
    // the same audience. When they are, BOTH must pass (matches the Go SDK's
    // IsRequestSatisfiesAudience, which evaluates the query and then still
    // walks the value map).

    // First: check jsonlogic query if it exists
    if (audience.query) {
      let ok = false;
      const logFields = { audience: audience.name, query: audience.query, context };
      const scopedTrace = (
        level: TraceLevel,
        id: string,
        message: string,
        extra: Record<string, unknown> = {},
      ): void => {
        trace(level, id, message, { ...logFields, ...extra });
      };
      try {
        const queryResult = applyJsonLogicWithCustomOperators(audience.query, context);

        if (queryResult === true || queryResult === "true") {
          scopedTrace(TraceLevel.DEBUG, "JSONLOGIC_SUCCESS", "JsonLogic query evaluated to true");
          ok = true;
        } else if (queryResult === false || queryResult === "false") {
          scopedTrace(TraceLevel.WARN, "JSONLOGIC_FAIL", "JsonLogic query evaluated to false");
        } else {
          scopedTrace(TraceLevel.ERROR, "JSONLOGIC_ERROR", "Failed to evaluate jsonlogic query as boolean", {
            result: queryResult,
          });
        }
      } catch (error) {
        scopedTrace(TraceLevel.ERROR, "JSONLOGIC_EXCEPTION", "Exception during jsonlogic evaluation", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      satisfied = satisfied && ok;
    }

    // Then: value-based conditions (evaluated whenever present, regardless of
    // whether a query was also evaluated above).
    if (audience.value) {
      for (const [key, values] of Object.entries(audience.value)) {
        // iteration 1 key: "color", values: ["blue", "purple"]
        // compare the context set to the rule set
        const contextValues = toArray(context[key]);
        const passed = evaluateConditions(contextValues, values);
        if (!passed) {
          trace(TraceLevel.WARN, "FAIL", `context:'${contextValues}' fails check: ${key}:'${values}'`, {
            contextValues,
            values,
          });
          // Don't short circuit. Any failure fails the whole thing, but
          // we want to trace all failures for observability.
        } else {
          trace(TraceLevel.DEBUG, "SUCCESS", `context:'${contextValues}' found in ${key}:'${values}'`, {
            contextValues,
            values,
          });
        }
        satisfied = satisfied && passed;
      }
    }
  }
  if (satisfied) {
    // Don't bother adding context fields
    trace(TraceLevel.DEBUG, "SUCCESS", "All Audience Rules Satisfied", {});
  }
  return satisfied;
}

export function contextSatisfiesAllowListItem(contextValue?: ContextValue, value?: AllowListValue): boolean {
  const values = value?.values;
  if (!contextValue || !Array.isArray(values)) {
    return false;
  }
  const contextValues = toArray(contextValue);

  // EQ seems to be the only supported Op right now.
  // And it's also the default. ¯\_(ツ)_/¯
  // `value` is defined because 'value?.values' is an array, but
  // that's too much for the Typescript null flow analyzer.
  const operation = value?.op?.toUpperCase();
  switch (operation) {
    case "EQ":
    default:
      return hasNonEmptyIntersection(contextValues, values);
  }
}

// Generic over anything whitelist-shaped (Treatment, and later FlagVariant)
// so flags' legacy whitelist scan can reuse this without reshaping into a
// Treatment. Trace ids/behavior are unchanged from the original
// treatmentFromAllowList (no id prefix - matches existing usage exactly).
export function findAllowListMatch<T extends { whitelist?: { items?: AllowListItems } }>(
  items: T[] | undefined,
  context: UserContext | undefined,
  trace: TraceFn,
): T | undefined {
  trace(TraceLevel.DEBUG, "ENTERING", "treatmentFromAllowList()", { context });
  if (!context || !Array.isArray(items)) {
    trace(TraceLevel.WARN, "NO_ALLOWLIST", "Either no context or no treatments to match", {
      context,
      treatments: items,
    });
    return undefined;
  }

  const match = items.find((item) => {
    const allowListItems = item?.whitelist?.items;
    if (!allowListItems || Object.keys(allowListItems).length < 1) {
      return false;
    }
    return Object.entries(allowListItems).every(([key, value]) => {
      return contextSatisfiesAllowListItem(context[key], value);
    });
  });

  if (match) {
    trace(TraceLevel.INFO, "MATCHED", "AllowListed Treatment Found", { context, treatment: match });
  } else {
    // This is the normal case
    trace(TraceLevel.DEBUG, "NO_MATCH", "No AllowListed Treatment Found", { context, treatments: items });
  }

  return match;
}

function toArray(contextValue: ContextValue): string[] {
  if (Array.isArray(contextValue)) {
    return contextValue;
  }

  // If it was a string, assume it may be comma delimited
  return (contextValue ?? "").split(",").map((s) => {
    return s.trim();
  });
}

// Treat 2 arrays as sets and return true if they have
// any elements in common.
function hasNonEmptyIntersection(set_a: string[], set_b: string[]): boolean {
  return set_a.some((a) => {
    return set_b.some((b) => {
      return a.toUpperCase() === b.toUpperCase();
    });
  });
}

// --- Audience value-path condition grammar --------------------------------
// Ported from the Go labs audience-control-library (audience/utils.go) so the
// TS SDK honors the same operator grammar embedded in condition strings:
//   - "xbox"     exact, case-insensitive match (EQ)
//   - "!xbox"    negation (NOT EQ)
//   - ">=7.2.0"  relational/semver comparison (operators <, >, <=, >=, =)
// A field's condition array is OR'd together, UNLESS any condition is a
// negation, in which case the array is AND'd (matches Go's evaluateConditions).
// This operator-in-the-string convention is the same short/medium-term scheme
// the Go/Java SDKs use until an explicit operator is modeled on the audience.

function conditionIsLogicalNot(condition: string): boolean {
  return condition.startsWith("!") && condition.length > 1;
}

function conditionIsRelationalCompare(condition: string): boolean {
  return condition.startsWith("<") || condition.startsWith(">") || condition.startsWith("=");
}

function equalsFold(a: string, b: string): boolean {
  return a.toUpperCase() === b.toUpperCase();
}

// Compare a context value against a relational condition (e.g. ">=3.2.0").
// Falls back to case-insensitive equality when no operator is present.
function compareRange(value: string, condition: string): boolean {
  let operator = "";
  if (conditionIsRelationalCompare(condition)) {
    operator += condition[0]; // <, > or =
    condition = condition.slice(1);
  }
  if (condition.startsWith("=")) {
    operator += "=";
    condition = condition.slice(1);
  }
  if (operator.length === 0) {
    return equalsFold(value, condition);
  }
  return semverCompare(value, operator, condition);
}

// Evaluate a single condition against the set of context tokens. Any token
// satisfying the condition makes it true; a leading "!" inverts the result.
function evaluateConditionWithValues(contextValues: string[], condition: string): boolean {
  const isLogicalNot = conditionIsLogicalNot(condition);
  if (isLogicalNot) {
    condition = condition.slice(1);
  }
  const compare = conditionIsRelationalCompare(condition) ? compareRange : equalsFold;

  let metCondition = false;
  for (const value of contextValues) {
    metCondition = compare(value, condition);
    if (metCondition) {
      break;
    }
  }
  return isLogicalNot ? !metCondition : metCondition;
}

// Evaluate a field's array of conditions. OR semantics by default; if any
// condition is a negation the whole array becomes AND (Go parity).
function evaluateConditions(contextValues: string[], conditions: string[]): boolean {
  const containsLogicalNot = conditions.some(conditionIsLogicalNot);
  return containsLogicalNot
    ? conditions.every((c) => evaluateConditionWithValues(contextValues, c))
    : conditions.some((c) => evaluateConditionWithValues(contextValues, c));
}

export { AudienceService as _internalAudienceService };
