import { main } from "../src/cli/main";
import * as decisionModule from "../src/cli/decision";
import * as compareModule from "../src/cli/compare";

jest.mock("../src/cli/decision");
jest.mock("../src/cli/compare");

let stdoutSpy: jest.SpyInstance;
let stderrSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  stdoutSpy = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderrSpy = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
});

function stdoutText(): string {
  return stdoutSpy.mock.calls.map((call) => call[0]).join("");
}

function stderrText(): string {
  return stderrSpy.mock.calls.map((call) => call[0]).join("");
}

test("--help prints usage to stdout and exits 0, without running a decision", async () => {
  const code = await main(["--help"]);
  expect(code).toBe(0);
  expect(stdoutText()).toContain("labs-cli - probe live Labs SDK decisions");
  expect(decisionModule.runDecision).not.toHaveBeenCalled();
});

test("an argument-parsing error exits 2 and prints to stderr", async () => {
  const code = await main(["--not-a-flag"]);
  expect(code).toBe(2);
  expect(stderrText()).toContain("Unknown flag: --not-a-flag");
});

test("a runDecision error exits 1 and prints to stderr", async () => {
  (decisionModule.runDecision as jest.Mock).mockRejectedValue(new Error("boom"));
  const code = await main(["--env", "dev", "--exp-id", "exp-1", "--context", "{}"]);
  expect(code).toBe(1);
  expect(stderrText()).toContain("Error: boom");
});

test("a successful decision (no --compare) prints the result as JSON and exits 0", async () => {
  (decisionModule.runDecision as jest.Mock).mockResolvedValue({ active: true, treatmentId: "t1" });
  const code = await main(["--env", "dev", "--exp-id", "exp-1", "--context", "{}"]);
  expect(code).toBe(0);
  expect(JSON.parse(stdoutText())).toEqual({ active: true, treatmentId: "t1" });
});

test("--compare go without --go-cli-path exits 2 with a clear error", async () => {
  (decisionModule.runDecision as jest.Mock).mockResolvedValue({ active: true });
  const code = await main(["--env", "dev", "--exp-id", "exp-1", "--context", "{}", "--compare", "go"]);
  expect(code).toBe(2);
  expect(stderrText()).toContain("--compare go requires --go-cli-path");
  expect(compareModule.runGoCli).not.toHaveBeenCalled();
});

test("--compare java without --java-cli-jar exits 2 with a clear error", async () => {
  (decisionModule.runDecision as jest.Mock).mockResolvedValue({ active: true });
  const code = await main(["--env", "dev", "--exp-id", "exp-1", "--context", "{}", "--compare", "java"]);
  expect(code).toBe(2);
  expect(stderrText()).toContain("--compare java requires --java-cli-jar");
});

test("--compare go runs the Go CLI and includes its result + comparison in the printed output", async () => {
  (decisionModule.runDecision as jest.Mock).mockResolvedValue({ active: true });
  (compareModule.runGoCli as jest.Mock).mockResolvedValue({
    target: "go",
    command: "fake",
    ok: true,
    parsed: { active: true },
  });
  (compareModule.compareActive as jest.Mock).mockReturnValue({
    match: true,
    tsActive: true,
    otherActive: true,
  });

  const code = await main([
    "--env",
    "dev",
    "--exp-id",
    "exp-1",
    "--context",
    "{}",
    "--compare",
    "go",
    "--go-cli-path",
    "./labs-cli",
  ]);

  expect(code).toBe(0);
  const printed = JSON.parse(stdoutText());
  expect(printed.ts).toEqual({ active: true });
  expect(printed.comparisons.go.ok).toBe(true);
  expect(printed.comparisons.go.activeComparison).toEqual({ match: true, tsActive: true, otherActive: true });
  expect(compareModule.runGoCli).toHaveBeenCalledWith("./labs-cli", expect.anything());
});
