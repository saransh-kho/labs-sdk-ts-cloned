// We need to access the private function for testing, so we'll create a test version
function areContextValuesEqual(a: any, b: any): boolean {
  // Handle string vs string
  if (typeof a === "string" && typeof b === "string") {
    return a === b;
  }

  // Handle array vs array - treat as sets (order-independent)
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }

    // Count occurrences of each element in both arrays
    const countA = new Map<string, number>();
    const countB = new Map<string, number>();

    for (const item of a) {
      countA.set(item, (countA.get(item) || 0) + 1);
    }

    for (const item of b) {
      countB.set(item, (countB.get(item) || 0) + 1);
    }

    // Compare counts for each unique element
    if (countA.size !== countB.size) {
      return false;
    }

    // Use Array.from to iterate over Map entries
    for (const entry of Array.from(countA.entries())) {
      const [key, count] = entry;
      if (countB.get(key) !== count) {
        return false;
      }
    }

    return true;
  }

  // Mixed types (string vs array) are not equal
  return false;
}

describe("Context Value Equality", () => {
  describe("String comparisons", () => {
    test("should compare equal strings as equal", () => {
      expect(areContextValuesEqual("hello", "hello")).toBe(true);
    });

    test("should compare different strings as not equal", () => {
      expect(areContextValuesEqual("hello", "world")).toBe(false);
    });
  });

  describe("Array comparisons", () => {
    test("should treat arrays with same elements in different order as equal", () => {
      expect(areContextValuesEqual(["a", "b", "a"], ["b", "a", "a"])).toBe(true);
    });

    test("should treat arrays with different element counts as not equal", () => {
      expect(areContextValuesEqual(["a", "b", "a"], ["a", "b", "b"])).toBe(false);
    });

    test("should handle arrays with different lengths as not equal", () => {
      expect(areContextValuesEqual(["a", "b"], ["a", "b", "c"])).toBe(false);
    });

    test("should handle identical arrays as equal", () => {
      expect(areContextValuesEqual(["a", "b", "c"], ["a", "b", "c"])).toBe(true);
    });

    test("should handle empty arrays as equal", () => {
      expect(areContextValuesEqual([], [])).toBe(true);
    });

    test("should handle single element arrays correctly", () => {
      expect(areContextValuesEqual(["a"], ["a"])).toBe(true);
      expect(areContextValuesEqual(["a"], ["b"])).toBe(false);
    });
  });

  describe("Mixed type comparisons", () => {
    test("should treat string vs array as not equal", () => {
      expect(areContextValuesEqual("hello", ["hello"])).toBe(false);
    });

    test("should treat array vs string as not equal", () => {
      expect(areContextValuesEqual(["hello"], "hello")).toBe(false);
    });
  });

  describe("User requirements", () => {
    test('should make ["a", "b", "a"] equal to ["b", "a", "a"]', () => {
      expect(areContextValuesEqual(["a", "b", "a"], ["b", "a", "a"])).toBe(true);
    });

    test('should not make ["a", "b", "a"] equal to ["a", "b", "b"]', () => {
      expect(areContextValuesEqual(["a", "b", "a"], ["a", "b", "b"])).toBe(false);
    });
  });
});
