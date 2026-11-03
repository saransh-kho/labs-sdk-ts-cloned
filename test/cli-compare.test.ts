import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildGoArgs,
  buildJavaArgs,
  compareActive,
  parseGoOutput,
  parseJavaOutput,
  runGoCli,
} from "../src/cli/compare";
import { CliOptions } from "../src/cli/args";

function baseOptions(overrides: Partial<CliOptions> = {}): CliOptions {
  return {
    help: false,
    showConfig: false,
    track: false,
    compare: [],
    ...overrides,
  };
}

test("buildGoArgs translates options into Go's single-dash flag names", () => {
  const args = buildGoArgs(
    baseOptions({ environment: "int", expId: "exp-1", seed: "s1", context: '{"a":"b"}' }),
  );
  expect(args).toEqual(["-env", "int", "-exp-id", "exp-1", "-context", '{"a":"b"}', "-seed", "s1"]);
});

test("buildGoArgs defaults --context to '{}' when omitted", () => {
  const args = buildGoArgs(baseOptions({ environment: "int", flagId: "flag-1" }));
  expect(args).toEqual(["-env", "int", "-flag-id", "flag-1", "-context", "{}"]);
});

test("buildJavaArgs translates options into Java's double-dash flag names", () => {
  const args = buildJavaArgs(
    baseOptions({ environment: "int", flagKey: "my-flag", projectId: "proj-1", seed: "s1", context: "{}" }),
  );
  expect(args).toEqual([
    "--env",
    "int",
    "--flag-key",
    "my-flag",
    "--project-id",
    "proj-1",
    "--context",
    "{}",
    "--seed",
    "s1",
  ]);
});

test("buildGoArgs and buildJavaArgs translate TS's long environment names to Go/Java's short codes", () => {
  expect(buildGoArgs(baseOptions({ environment: "stage", expId: "exp-1" }))).toEqual([
    "-env",
    "stg",
    "-exp-id",
    "exp-1",
    "-context",
    "{}",
  ]);
  expect(buildGoArgs(baseOptions({ environment: "prod", expId: "exp-1" }))).toEqual([
    "-env",
    "prd",
    "-exp-id",
    "exp-1",
    "-context",
    "{}",
  ]);
  expect(buildJavaArgs(baseOptions({ environment: "stage", expId: "exp-1" }))).toEqual([
    "--env",
    "stg",
    "--exp-id",
    "exp-1",
    "--context",
    "{}",
  ]);
  expect(buildJavaArgs(baseOptions({ environment: "prod", expId: "exp-1" }))).toEqual([
    "--env",
    "prd",
    "--exp-id",
    "exp-1",
    "--context",
    "{}",
  ]);
  // "int"/"dev" are already the short form in both TS and Go/Java - pass through unchanged.
  expect(buildGoArgs(baseOptions({ environment: "dev", expId: "exp-1" }))).toEqual([
    "-env",
    "dev",
    "-exp-id",
    "exp-1",
    "-context",
    "{}",
  ]);
});

test("parseGoOutput strips the '=== label ===' header line and parses the rest as JSON", () => {
  const stdout = '=== decision ===\n{\n  "active": true,\n  "treatmentId": "t1"\n}\n';
  expect(parseGoOutput(stdout)).toEqual({ active: true, treatmentId: "t1" });
});

test("parseJavaOutput scrapes 'Key: Value' lines into a plain object", () => {
  const stdout = [
    "=== Experiment Decision ===",
    "ID: exp-1",
    "Variant Key: T1",
    "Active: true",
    "Source: FEATURE",
    "",
  ].join("\n");
  expect(parseJavaOutput(stdout)).toEqual({
    ID: "exp-1",
    "Variant Key": "T1",
    Active: true,
    Source: "FEATURE",
  });
});

test("parseJavaOutput converts 'true'/'false' strings to real booleans", () => {
  const stdout = "Active: false\n";
  expect(parseJavaOutput(stdout)).toEqual({ Active: false });
});

test("compareActive reports a match when both sides agree", () => {
  const result = compareActive(
    { active: true },
    { target: "go", command: "x", ok: true, parsed: { active: true } },
  );
  expect(result).toEqual({ match: true, tsActive: true, otherActive: true });
});

test("compareActive reports a mismatch when the sides disagree", () => {
  const result = compareActive(
    { active: true },
    { target: "java", command: "x", ok: true, parsed: { Active: false } },
  );
  expect(result).toEqual({ match: false, tsActive: true, otherActive: false });
});

test("compareActive returns undefined when the other side has no parsed output", () => {
  const result = compareActive({ active: true }, { target: "go", command: "x", ok: false, error: "boom" });
  expect(result).toBeUndefined();
});

describe("runGoCli (child_process plumbing, against a fake executable)", () => {
  let fakeCliPath: string;

  beforeAll(() => {
    fakeCliPath = path.join(os.tmpdir(), `fake-labs-cli-${process.pid}.js`);
    fs.writeFileSync(
      fakeCliPath,
      [
        "#!/usr/bin/env node",
        'console.log("=== decision ===");',
        'console.log(JSON.stringify({ active: true, treatmentId: "t1" }));',
      ].join("\n"),
    );
    fs.chmodSync(fakeCliPath, 0o755);
  });

  afterAll(() => {
    fs.unlinkSync(fakeCliPath);
  });

  test("invokes the binary, captures stdout, and parses it as Go-shaped output", async () => {
    const result = await runGoCli(
      fakeCliPath,
      baseOptions({ environment: "dev", expId: "exp-1", context: "{}" }),
    );
    expect(result.ok).toBe(true);
    expect(result.parsed).toEqual({ active: true, treatmentId: "t1" });
  });

  test("reports ok:false with the error message when the binary doesn't exist", async () => {
    const result = await runGoCli("/no/such/binary", baseOptions({ environment: "dev", expId: "exp-1" }));
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});
