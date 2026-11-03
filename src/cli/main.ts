import { parseArgs } from "./args";
import { runDecision } from "./decision";
import { compareActive, runGoCli, runJavaCli } from "./compare";
import { printError, printResult } from "./output";

const USAGE = `labs-cli - probe live Labs SDK decisions from the command line.

Usage:
  labs-cli --env <env> --context '<json>' [options]

Decision target (one of):
  --exp-id <uuid>          Experiment UUID
  --flag-id <uuid>         Feature flag UUID
  --flag-key <key>         Flag key (requires --project-id)

Required:
  --env <prod|stage|int|dev>   Environment shorthand (or --fetch-url/--track-url explicitly)
  --context <json>             Decision context, e.g. '{"profileId":"p1"}' (use '{}' if empty)

Optional:
  --seed <id>                       Bucketing seed
  --show-config                    Print resolved URLs and exit (no decision)
  --track                          Actually send the tracking event (default: suppressed via a null: sink)
  --trace <level>                  debug|info|warn|error - stream SDK trace events to stderr as JSON lines
  --timeout-ms <n>                 Per-request timeout in ms (default 10000)
  --fetch-url/--track-url/--flag-fetch-url <url>   Explicit URL overrides (win over --env)

Cross-SDK comparison:
  --compare go,java          Also run the Go and/or Java labs-cli against the same inputs
  --go-cli-path <path>       Path to a pre-built Go labs-cli binary (required for --compare go)
  --java-cli-jar <path>      Path to a pre-built Java labs-cli jar (required for --compare java)

Output is always a single JSON value on stdout. Errors and --trace events go to stderr.

Examples:
  labs-cli --env int --exp-id <uuid> --context '{"profileId":"p1"}'
  labs-cli --env dev --flag-key my-flag --project-id <proj> --context '{}' --seed s1
  labs-cli --env prod --show-config
  labs-cli --env int --exp-id <uuid> --context '{}' --compare go,java --go-cli-path ./labs-cli --java-cli-jar ./labs-cli.jar
`;

export async function main(argv: string[]): Promise<number> {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    return 2;
  }

  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  let tsResult: unknown;
  try {
    tsResult = await runDecision(options);
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (options.compare.length === 0) {
    printResult(tsResult);
    return 0;
  }

  const comparisons: Record<string, unknown> = {};

  if (options.compare.includes("go")) {
    if (!options.goCliPath) {
      printError("--compare go requires --go-cli-path");
      return 2;
    }
    const goResult = await runGoCli(options.goCliPath, options);
    comparisons.go = {
      ...goResult,
      activeComparison: compareActive(tsResult as Record<string, unknown>, goResult),
    };
  }

  if (options.compare.includes("java")) {
    if (!options.javaCliJar) {
      printError("--compare java requires --java-cli-jar");
      return 2;
    }
    const javaResult = await runJavaCli(options.javaCliJar, options);
    comparisons.java = {
      ...javaResult,
      activeComparison: compareActive(tsResult as Record<string, unknown>, javaResult),
    };
  }

  printResult({ ts: tsResult, comparisons });
  return 0;
}
