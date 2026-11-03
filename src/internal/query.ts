import { CustomOperators, UserContext } from "../types";
// Import json-logic-engine library (ES module compatible)
import { LogicEngine } from "json-logic-engine";
import { semverCompare } from "./semver";

// Create a wrapper to ensure we have access to the jsonLogic object
const getJsonLogic = () => {
  // The library should be available as a namespace import
  if (LogicEngine && typeof LogicEngine === "function") {
    return LogicEngine;
  }

  throw new Error("json-logic-engine library not available");
};

// Singleton logic engine with custom operators registered once
class CustomLogicEngine {
  private static instance: CustomLogicEngine;
  private initialized = false;
  private engine: any = null;

  private constructor() {
    this.registerCustomOperators();
  }

  static getInstance(): CustomLogicEngine {
    if (!CustomLogicEngine.instance) {
      CustomLogicEngine.instance = new CustomLogicEngine();
    }
    return CustomLogicEngine.instance;
  }

  private registerCustomOperators() {
    if (this.initialized) return;
    const LogicEngineClass = getJsonLogic();
    this.engine = new LogicEngineClass();

    const customOperators = createCustomOperators();
    Object.entries(customOperators).forEach(([name, fn]) => {
      this.engine.addMethod(name, fn);
    });
    this.initialized = true;
  }

  apply(query: string, context: UserContext): boolean | null {
    try {
      const logicExpression = JSON.parse(query);
      const result = this.engine.run(logicExpression, context);
      return Boolean(result);
    } catch (error) {
      return null;
    }
  }
}

// Custom operator implementations matching JLQuery behavior
function createCustomOperators(): CustomOperators {
  return {
    // Regex matching operator: {"=~": [subject, pattern]}
    "=~": (...args: any[]): boolean => {
      // json-logic-engine passes arguments as: [operands_array, context, other, engine]
      const operands = args[0];

      if (!Array.isArray(operands) || operands.length !== 2) {
        throw new Error(
          `=~ requires exactly 2 operands: subject, pattern, got ${operands?.length || 0}: ${JSON.stringify(operands)}`,
        );
      }

      const [subject, pattern] = operands;

      try {
        const subjectStr = String(subject);
        const patternStr = String(pattern);
        const regex = new RegExp(patternStr);
        return regex.test(subjectStr);
      } catch (error) {
        return false;
      }
    },

    // Semantic version comparison: {"semver_cmp": [operator, operand1, operand2, ...]}
    semver_cmp: (...args: any[]): boolean => {
      // json-logic-engine passes arguments as: [operands_array, context, other, engine]
      const operands = args[0];

      if (!Array.isArray(operands) || operands.length < 3) {
        throw new Error(
          `semver_cmp requires at least 3 operands: operator, operand1, operand2, got ${operands?.length || 0}`,
        );
      }

      const [operator, ...versionOperands] = operands;
      const operatorStr = String(operator);
      const ops = versionOperands.map((v) => String(v));

      if (ops.length < 2 || ops.length > 3) {
        throw new Error(`semver_cmp requires 2 or 3 version operands, got ${ops.length}`);
      }

      // Handle equality operators (only 2 operands)
      if (operatorStr === "==" || operatorStr === "!=") {
        if (ops.length !== 2) {
          throw new Error(`${operatorStr} requires exactly 2 operands`);
        }
        return semverCompare(ops[0], operatorStr, ops[1]);
      }

      // Handle ordering operators (2 or 3 operands)
      if (["<", "<=", ">", ">="].includes(operatorStr)) {
        if (ops.length === 2) {
          // Simple comparison: a op b
          return semverCompare(ops[0], operatorStr, ops[1]);
        } else {
          // Chained comparison: a op b op c
          return semverCompare(ops[0], operatorStr, ops[1]) && semverCompare(ops[1], operatorStr, ops[2]);
        }
      }

      throw new Error(`unsupported semver operator: ${operatorStr}`);
    },

    // Case-insensitive comparison: {"icase_compare": [operator, operand1, operand2, ...]}
    icase_compare: (...args: any[]): boolean => {
      // json-logic-engine passes arguments as: [operands_array, context, other, engine]
      const operands = args[0];

      if (!Array.isArray(operands) || operands.length < 3) {
        throw new Error(
          `icase_compare requires at least 3 operands: operator, operand1, operand2, got ${operands?.length || 0}: ${JSON.stringify(operands)}`,
        );
      }

      const [operator, operand1, ...otherOperands] = operands;
      const operatorStr = String(operator);
      const operand1Str = String(operand1);

      if (operatorStr === "in") {
        if (otherOperands.length !== 1) {
          throw new Error("icase_compare 'in' requires 2 operands 'search' and 'haystack' string/array");
        }

        const haystack = otherOperands[0];

        if (typeof haystack === "string") {
          // Substring search (use locale-aware lowercasing)
          const needle = operand1Str.toLocaleLowerCase();
          const haystackStr = haystack.toLocaleLowerCase();
          return haystackStr.includes(needle);
        } else if (Array.isArray(haystack)) {
          // Array element search using locale-aware case-insensitive comparison
          return haystack.some((item) => icaseCompareStrings(operand1Str, String(item)) === 0);
        }
      }

      // Quantifier mode: all | some | none
      if (operatorStr === "all" || operatorStr === "some" || operatorStr === "none") {
        if (otherOperands.length !== 2) {
          throw new Error(`icase_compare '${operatorStr}' requires 4 elements [quantifier, op, left, right]`);
        }

        const comparator = String(operand1);
        const [leftRaw, rightRaw] = otherOperands;

        return evaluateQuantifiedICaseCompare(operatorStr, comparator, leftRaw, rightRaw);
      }

      // Convert operands to strings for comparison
      const stringOperands = [operand1Str, ...otherOperands.map((op) => String(op))];

      if (["==", "!="].includes(operatorStr)) {
        if (stringOperands.length !== 2) {
          throw new Error(`${operatorStr} requires exactly 2 operands`);
        }
        const cmp = icaseCompareStrings(stringOperands[0], stringOperands[1]);
        const result = cmp === 0;
        return operatorStr === "==" ? result : !result;
      }

      if (["<", "<=", ">", ">="].includes(operatorStr)) {
        if (stringOperands.length === 2) {
          // Simple comparison
          const cmp = icaseCompareStrings(stringOperands[0], stringOperands[1]);
          return compareWithOperator(cmp, operatorStr);
        } else {
          // Chained comparison
          const ab = icaseCompareStrings(stringOperands[0], stringOperands[1]);
          const bc = icaseCompareStrings(stringOperands[1], stringOperands[2]);
          return compareWithOperator(ab, operatorStr) && compareWithOperator(bc, operatorStr);
        }
      }

      throw new Error(`unsupported icase_compare operator: ${operatorStr}`);
    },
  };
}

// Locale-aware, case-insensitive string comparison used by icase_compare
// Uses Intl.Collator with base sensitivity to ignore case (and most accents) in a culturally-aware way.
const icaseCollator = new Intl.Collator(undefined, { sensitivity: "base", usage: "search" });

function icaseCompareStrings(a: string, b: string): number {
  return icaseCollator.compare(a, b);
}

function compareWithOperator(result: number, operator: string): boolean {
  switch (operator) {
    case "<":
      return result < 0;
    case "<=":
      return result <= 0;
    case ">":
      return result > 0;
    case ">=":
      return result >= 0;
    default:
      return false;
  }
}

/**
 * Evaluate quantifier-based case-insensitive comparisons: all | some | none
 * Mirrors the Go / Java icase_compare quantifier semantics.
 */
function evaluateQuantifiedICaseCompare(
  quantifier: string,
  comparator: string,
  left: any,
  right: any,
): boolean {
  const leftValues = normalizeICaseSide(left);
  const rightValues = normalizeICaseSide(right);

  // Outlier default matches Go semantics:
  // - all / none => true when left is empty
  // - some      => false when left is empty
  let outlierDefault: boolean;
  switch (quantifier) {
    case "all":
    case "none":
      outlierDefault = true;
      break;
    case "some":
      outlierDefault = false;
      break;
    default:
      throw new Error(`unsupported quantifier: ${quantifier}`);
  }

  // If left side is empty, quantifier result falls back to outlier default
  if (leftValues.length === 0) {
    return outlierDefault;
  }

  for (const leftVal of leftValues) {
    let found = false;

    for (const rightVal of rightValues) {
      let ok: boolean;

      try {
        ok = compareICasePair(comparator, leftVal, rightVal);
      } catch (e: any) {
        throw new Error(`icase_compare quantifier comparison error: ${e?.message || String(e)}`);
      }

      if (ok) {
        found = true;
        break;
      }
    }

    switch (quantifier) {
      case "all":
        if (!found) {
          return false;
        }
        break;
      case "some":
        if (found) {
          return true;
        }
        break;
      case "none":
        if (found) {
          return false;
        }
        break;
      default:
        throw new Error(`unsupported quantifier: ${quantifier}`);
    }
  }

  // If we exhaust all left values without early return, use outlier default
  return outlierDefault;
}

/**
 * Normalize a side of icase_compare to a string array:
 * - Arrays => element strings
 * - Scalars => comma-delimited string splits
 */
function normalizeICaseSide(value: any): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v));
  }

  const scalar = String(value);
  // Split on comma, preserving empty segments (behaves like Go's strings.Split)
  return scalar.split(",");
}

/**
 * Compare two string operands case-insensitively using the existing icase logic.
 */
function compareICasePair(operator: string, left: string, right: string): boolean {
  const operands = [String(left), String(right)];

  if (["==", "!="].includes(operator)) {
    if (operands.length !== 2) {
      throw new Error(`${operator} requires exactly 2 operands`);
    }
    const cmp = icaseCompareStrings(operands[0], operands[1]);
    const result = cmp === 0;
    return operator === "==" ? result : !result;
  }

  if (["<", "<=", ">", ">="].includes(operator)) {
    if (operands.length > 3) {
      throw new Error(`${operator} requires 2 or 3 operands`);
    }

    if (operands.length === 2) {
      const cmp = icaseCompareStrings(operands[0], operands[1]);
      return compareWithOperator(cmp, operator);
    }
  }

  throw new Error(`unsupported icase_compare comparator: ${operator}`);
}

export function applyJsonLogicWithCustomOperators(
  query: string,
  context: UserContext,
): boolean | string | null {
  return CustomLogicEngine.getInstance().apply(query, context);
}
