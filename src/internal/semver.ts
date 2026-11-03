import { compareVersions } from "compare-versions";

// Liberal normalization that mirrors the Go SDK's go-version.Normalize for the
// common cases the audience grammar cares about: trim whitespace and drop a
// leading "v". compare-versions already tolerates partial versions ("2",
// "1.2") and prerelease tags, which covers the rest of the practical inputs.
function normalize(value: string): string {
  return String(value).trim().replace(/^[vV]/, "");
}

/**
 * Compares two version strings with the given relational/equality operator and
 * returns the boolean result. This is the single semver engine shared by the
 * audience value-path (relational conditions like ">=7.2.0") and the jsonlogic
 * `semver_cmp` operator, matching the Go SDK which routes both through
 * go-version's CompareNormalized.
 *
 * Supported operators: <, <=, >, >=, =, ==, != . Invalid version inputs yield
 * false rather than throwing, so a malformed rule fails the check instead of
 * aborting the whole decision.
 */
export function semverCompare(left: string, operator: string, right: string): boolean {
  let cmp: number;
  try {
    cmp = compareVersions(normalize(left), normalize(right));
  } catch {
    return false;
  }

  switch (operator) {
    case "<":
      return cmp < 0;
    case "<=":
      return cmp <= 0;
    case ">":
      return cmp > 0;
    case ">=":
      return cmp >= 0;
    case "=":
    case "==":
      return cmp === 0;
    case "!=":
      return cmp !== 0;
    default:
      return false;
  }
}
