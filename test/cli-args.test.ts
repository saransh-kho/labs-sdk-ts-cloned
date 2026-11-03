import { parseArgs } from "../src/cli/args";

test("parses --flag value pairs", () => {
  const options = parseArgs(["--env", "dev", "--exp-id", "abc", "--context", "{}"]);
  expect(options.environment).toBe("dev");
  expect(options.expId).toBe("abc");
  expect(options.context).toBe("{}");
});

test("parses --flag=value syntax", () => {
  const options = parseArgs(["--env=stage", "--seed=s1"]);
  expect(options.environment).toBe("stage");
  expect(options.seed).toBe("s1");
});

test("parses boolean flags without a value", () => {
  const options = parseArgs(["--show-config", "--track"]);
  expect(options.showConfig).toBe(true);
  expect(options.track).toBe(true);
});

test("--help / -h set the help flag", () => {
  expect(parseArgs(["--help"]).help).toBe(true);
  expect(parseArgs(["-h"]).help).toBe(true);
  expect(parseArgs([]).help).toBe(false);
});

test("defaults are sane when nothing is passed", () => {
  const options = parseArgs([]);
  expect(options.showConfig).toBe(false);
  expect(options.track).toBe(false);
  expect(options.compare).toEqual([]);
  expect(options.environment).toBeUndefined();
});

test("--id is an alias for --exp-id", () => {
  expect(parseArgs(["--id", "exp-1"]).expId).toBe("exp-1");
});

test("--compare parses a comma-separated list and ignores unknown targets", () => {
  expect(parseArgs(["--compare", "go,java"]).compare).toEqual(["go", "java"]);
  expect(parseArgs(["--compare", "go"]).compare).toEqual(["go"]);
  expect(parseArgs(["--compare", "go,bogus,java"]).compare).toEqual(["go", "java"]);
});

test("throws a clear error for an unknown flag", () => {
  expect(() => parseArgs(["--not-a-real-flag"])).toThrow("Unknown flag: --not-a-real-flag");
});

test("throws a clear error when a value-taking flag is missing its value", () => {
  expect(() => parseArgs(["--env"])).toThrow("Missing value for --env");
});

test("parses every flag used to build an SDKConfig", () => {
  const options = parseArgs([
    "--fetch-url",
    "http://fetch",
    "--track-url",
    "http://track",
    "--flag-fetch-url",
    "http://flags",
    "--flag-id",
    "flag-1",
    "--flag-key",
    "my-flag",
    "--project-id",
    "proj-1",
    "--timeout-ms",
    "5000",
    "--trace",
    "debug",
    "--go-cli-path",
    "./labs-cli",
    "--java-cli-jar",
    "./labs-cli.jar",
  ]);
  expect(options).toMatchObject({
    fetchUrl: "http://fetch",
    trackUrl: "http://track",
    flagFetchUrl: "http://flags",
    flagId: "flag-1",
    flagKey: "my-flag",
    projectId: "proj-1",
    timeoutMs: 5000,
    traceLevel: "debug",
    goCliPath: "./labs-cli",
    javaCliJar: "./labs-cli.jar",
  });
});
