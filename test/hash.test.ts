import { hash64 } from "../src/internal/hash";
import Long from "long";

// Cover most of the paths through the hashing code
// except several of the special cases for % 16 remainder
// handling

test("hash64('foo') returns expected result", async () => {
  // Same as the golang test values
  expect(hash64("foo").toString(16)).toEqual("7f843a73314fcf27");
});

// Each test case explores a different significant path in hash logic.
test.each([
  ["hash64('foot')", "foot", Long.fromString("5bbe34bac4d6a76a", true, 16)],
  [
    "hash64('<shortish string>')",
    "Lorem ipsum dolor sit amet",
    Long.fromString("ce89fe87dc868dcc", true, 16),
  ],
  [
    "hash64('<medium string>",
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit".repeat(2),
    Long.fromString("1800088ae3b9b0e6", true, 16),
  ],
  [
    "hash64('<long string>')",
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit".repeat(10),
    Long.fromString("38a646995a89b142", true, 16),
  ],
])(
  "%p converts to expected number",
  (name: string, input: string, result: Long): void => {
    const hashLong = hash64(input);
    const hashString = hashLong.toString(16);

    expect(hashLong.equals(result)).toBeTruthy();
    expect(hashString).toEqual(result.toString(16));
  }
);

test("Cover a span of similar input for expeected values", () => {
  let s = "";
  const expected = [
    "1a108191a0bbc9bd",
    "ad756653764f8b78",
    "a7cc89b147d4a85b",
    "39d058753d3e5435",
    "1a92fb992cd43dab",
    "e2407f707d93eb68",
    "7f630a0417ca573e",
    "6730ba89d8e37511",
    "79a7eb02ae4c4ddd",
    "9814307b22efc247",
    "604790ce1cafccb4",
    "d46624bce35f2748",
    "982f0465af1b6bd0",
    "3778d7cff3c87f91",
    "bd6c1d1d3124a7d5",
    "f52a377ca2b082eb",
  ];
  for (let n = 0; n < 16; n++) {
    s += "a";
    expect(hash64(s).toString(16)).toEqual(expected[n]);
  }
});
