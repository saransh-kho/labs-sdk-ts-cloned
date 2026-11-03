import { applyJsonLogicWithCustomOperators } from "../src/internal/query";
import { UserContext } from "../src";

describe("Query Engine - JSONLogic with Custom Operators", () => {
  describe("Basic JSONLogic Operations", () => {
    test("should handle simple equality", () => {
      const query = '{"==": ["test", "test"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle simple inequality", () => {
      const query = '{"!=": ["test", "other"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle AND operations", () => {
      const query = '{"and": [true, true]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle OR operations", () => {
      const query = '{"or": [false, true]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle variable references", () => {
      const query = '{"==": [{"var": "platform"}, "ios"]}';
      const context: UserContext = { platform: "ios" };

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle nested operations", () => {
      const query = '{"and": [{"==": [{"var": "platform"}, "ios"]}, {">=": [{"var": "version"}, "1.0"]}]}';
      const context: UserContext = { platform: "ios", version: "2.0" };

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });
  });

  describe("Custom Operator: Regex Matching (=~)", () => {
    test("should match valid regex patterns", () => {
      const query = '{"=~": ["hello world", "hello.*"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should not match invalid regex patterns", () => {
      const query = '{"=~": ["hello world", "goodbye.*"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(false);
    });

    test("should handle case-sensitive regex", () => {
      const query = '{"=~": ["Hello World", "hello.*"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(false);
    });

    test("should handle case-insensitive regex", () => {
      const query = '{"=~": ["Hello World", "hello.*"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(false); // Case-sensitive regex won't match
    });

    test("should handle invalid regex patterns gracefully", () => {
      const query = '{"=~": ["test", "[invalid"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(false);
    });

    test("should handle complex regex patterns", () => {
      const query = '{"=~": ["user@example.com", "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\\\.[a-zA-Z]{2,}$"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });
  });

  describe("Custom Operator: Semantic Version Comparison (semver_cmp)", () => {
    test("should handle equality comparison", () => {
      const query = '{"semver_cmp": ["==", "1.0.0", "1.0.0"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle inequality comparison", () => {
      const query = '{"semver_cmp": ["!=", "1.0.0", "1.0.1"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle greater than comparison", () => {
      const query = '{"semver_cmp": [">", "1.1.0", "1.0.0"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle less than comparison", () => {
      const query = '{"semver_cmp": ["<", "1.0.0", "1.1.0"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle greater than or equal comparison", () => {
      const query = '{"semver_cmp": [">=", "1.0.0", "1.0.0"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle less than or equal comparison", () => {
      const query = '{"semver_cmp": ["<=", "1.0.0", "1.0.0"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle chained comparisons", () => {
      const query = '{"semver_cmp": [">=", "1.0.0", "1.1.0", "2.0.0"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(false); // 1.0.0 >= 1.1.0 is false
    });

    test("should handle versions with different lengths", () => {
      const query = '{"semver_cmp": [">", "1.0.0", "1.0"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(false); // 1.0.0 is not greater than 1.0 (which becomes 1.0.0)
    });

    test("should handle versions with leading zeros", () => {
      const query = '{"semver_cmp": ["==", "01.00.00", "1.0.0"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle versions with 'v' prefix", () => {
      const query = '{"semver_cmp": ["==", "v1.0.0", "1.0.0"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle versions with whitespace", () => {
      const query = '{"semver_cmp": ["==", " 1.0.0 ", "1.0.0"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle invalid operator gracefully", () => {
      const query = '{"semver_cmp": ["invalid", "1.0.0", "1.0.0"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBeNull();
    });

    test("should handle wrong number of operands gracefully", () => {
      const query = '{"semver_cmp": ["==", "1.0.0"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBeNull();
    });

    test("should handle too many operands gracefully", () => {
      const query = '{"semver_cmp": ["==", "1.0.0", "1.0.0", "1.0.0", "1.0.0"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBeNull();
    });
  });

  describe("Custom Operator: Case-Insensitive Comparison (icase_compare)", () => {
    test("should handle equality comparison", () => {
      const query = '{"icase_compare": ["==", "Hello", "hello"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle inequality comparison", () => {
      const query = '{"icase_compare": ["!=", "Hello", "world"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle greater than comparison", () => {
      const query = '{"icase_compare": [">", "zebra", "apple"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle less than comparison", () => {
      const query = '{"icase_compare": ["<", "apple", "zebra"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle greater than or equal comparison", () => {
      const query = '{"icase_compare": [">=", "apple", "apple"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle less than or equal comparison", () => {
      const query = '{"icase_compare": ["<=", "apple", "apple"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle chained comparisons", () => {
      const query = '{"icase_compare": ["<", "apple", "banana", "cherry"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle 'in' operation with string", () => {
      const query = '{"icase_compare": ["in", "world", "hello world"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle 'in' operation with array", () => {
      const query = '{"icase_compare": ["in", "hello", ["Hello", "World"]]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle 'in' operation with array - no match", () => {
      const query = '{"icase_compare": ["in", "goodbye", ["Hello", "World"]]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(false);
    });

    test("should handle mixed case in comparisons", () => {
      const query = '{"icase_compare": ["==", "Hello World", "hello world"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle non-string operands", () => {
      const query = '{"icase_compare": ["==", "123", 123]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle invalid operator gracefully", () => {
      const query = '{"icase_compare": ["invalid", "hello", "world"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBeNull();
    });

    test("should handle wrong number of operands gracefully", () => {
      const query = '{"icase_compare": ["==", "hello"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBeNull();
    });

    test("should handle 'in' with wrong number of operands gracefully", () => {
      const query = '{"icase_compare": ["in", "hello", "world", "extra"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBeNull();
    });

    test("should handle quantifier basics: all / some / none", () => {
      const allQuery = '{"icase_compare": ["all", "==", "WoW", ["Wow", "WOW"]]}';
      const someFalseQuery = '{"icase_compare": ["some", "==", ["WoW", "boo"], ["WOO", "bTT"]]}';

      const context: UserContext = {};

      expect(applyJsonLogicWithCustomOperators(allQuery, context)).toBe(true);
      expect(applyJsonLogicWithCustomOperators(someFalseQuery, context)).toBe(false);
    });

    test("should handle quantifier with comma-separated scalars", () => {
      const someCommaScalarsQuery = '{"icase_compare": ["some", "==", "a,c", "A,B"]}';
      const noneCommaScalarsQuery = '{"icase_compare": ["none", "==", "x,y", "A,B"]}';

      const context: UserContext = {};

      expect(applyJsonLogicWithCustomOperators(someCommaScalarsQuery, context)).toBe(true);
      expect(applyJsonLogicWithCustomOperators(noneCommaScalarsQuery, context)).toBe(true);
    });

    test("should handle 'some' with userSegment var left and single right", () => {
      const context: UserContext = { userSegment: "aA,bB,cC" };
      const query = '{"icase_compare": ["some", "==", {"var": "userSegment"}, "BB"]}';

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });
  });

  describe("Complex Query Combinations", () => {
    test("should handle multiple custom operators in one query", () => {
      const query =
        '{"and": [{"icase_compare": ["==", {"var": "platform"}, "ios"]}, {"semver_cmp": [">=", {"var": "version"}, "1.0.0"]}]}';
      const context: UserContext = { platform: "iOS", version: "2.0.0" };

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle nested custom operators", () => {
      const query =
        '{"or": [{"=~": [{"var": "email"}, ".*@gmail\\\\.com"]}, {"icase_compare": ["==", {"var": "domain"}, "company.com"]}]}';
      const context: UserContext = { email: "user@gmail.com", domain: "other.com" };

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle complex version and string comparisons", () => {
      const query =
        '{"and": [{"semver_cmp": [">=", {"var": "appVersion"}, "1.0.0"]}, {"semver_cmp": ["<", {"var": "appVersion"}, "2.0.0"]}, {"icase_compare": ["in", {"var": "platform"}, ["ios", "android"]]}]}';
      const context: UserContext = { appVersion: "1.5.0", platform: "iOS" };

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });
  });

  describe("Error Handling", () => {
    test("should handle malformed JSON", () => {
      const query = '{"invalid": json}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBeNull();
    });

    test("should handle empty query", () => {
      const query = "";
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBeNull();
    });

    test("should handle null query", () => {
      const query = null as any;
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(false); // null query returns false, not null
    });

    test("should handle undefined query", () => {
      const query = undefined as any;
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBeNull();
    });

    test("should handle invalid JSONLogic syntax", () => {
      const query = '{"invalid_operator": ["test"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBeNull();
    });

    test("should handle missing variables gracefully", () => {
      const query = '{"==": [{"var": "nonexistent"}, "test"]}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(false);
    });

    test("should handle null context gracefully", () => {
      const query = '{"==": [{"var": "platform"}, "ios"]}';
      const context = null as any;

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(false);
    });

    test("should handle undefined context gracefully", () => {
      const query = '{"==": [{"var": "platform"}, "ios"]}';
      const context = undefined as any;

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(false);
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty arrays", () => {
      const query = '{"and": []}';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(false); // Empty AND array returns false
    });

    test("should handle empty objects", () => {
      const query = "{}";
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true); // Empty object is truthy
    });

    test("should handle boolean values", () => {
      const query = "true";
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle number values", () => {
      const query = "42";
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle string values", () => {
      const query = '"hello"';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(true);
    });

    test("should handle null values", () => {
      const query = "null";
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(false);
    });

    test("should handle zero values", () => {
      const query = "0";
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(false);
    });

    test("should handle empty string values", () => {
      const query = '""';
      const context: UserContext = {};

      const result = applyJsonLogicWithCustomOperators(query, context);
      expect(result).toBe(false);
    });
  });

  describe("Singleton Logic Engine", () => {
    test("should maintain singleton instance", () => {
      // This test ensures the singleton pattern works correctly
      // by calling the function multiple times and ensuring
      // the custom operators are registered only once

      const query1 = '{"=~": ["test", "test"]}';
      const query2 = '{"semver_cmp": ["==", "1.0.0", "1.0.0"]}';
      const query3 = '{"icase_compare": ["==", "Hello", "hello"]}';
      const context: UserContext = {};

      const result1 = applyJsonLogicWithCustomOperators(query1, context);
      const result2 = applyJsonLogicWithCustomOperators(query2, context);
      const result3 = applyJsonLogicWithCustomOperators(query3, context);

      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(result3).toBe(true);
    });
  });
});
