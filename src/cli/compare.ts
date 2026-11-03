import { execFile } from "child_process";
import { promisify } from "util";
import { CliOptions } from "./args";

const execFileAsync = promisify(execFile);

export type CompareResult = {
  target: "go" | "java";
  command: string;
  ok: boolean;
  raw?: string;
  parsed?: Record<string, unknown>;
  error?: string;
};

function contextArg(options: CliOptions): string {
  return options.context ?? "{}";
}

// TS's Environment type spells these out ("prod"/"stage"); Go/Java's CLIs
// use the short codes ("prd"/"stg") - Go documents "stage"/"prod" as
// tolerated aliases, but Java's picocli enum only accepts the short form
// literally, so a raw passthrough of --env silently breaks the Java target.
const SHORT_ENV: Record<string, string> = { prod: "prd", stage: "stg" };

function shortEnv(environment: string): string {
  return SHORT_ENV[environment] ?? environment;
}

// Go's labs-cli (cmd/labs-cli in labs-sdk-go) uses single-dash flags.
export function buildGoArgs(options: CliOptions): string[] {
  const args: string[] = [];
  if (options.environment) args.push("-env", shortEnv(options.environment));
  if (options.expId) args.push("-exp-id", options.expId);
  if (options.flagId) args.push("-flag-id", options.flagId);
  if (options.flagKey) args.push("-flag-key", options.flagKey);
  if (options.projectId) args.push("-project-id", options.projectId);
  args.push("-context", contextArg(options));
  if (options.seed) args.push("-seed", options.seed);
  if (options.showConfig) args.push("-show-config");
  return args;
}

// Java's labs-cli (tools/labs-cli in java-labs-sdk, picocli-based) uses
// double-dash flags.
export function buildJavaArgs(options: CliOptions): string[] {
  const args: string[] = [];
  if (options.environment) args.push("--env", shortEnv(options.environment));
  if (options.expId) args.push("--exp-id", options.expId);
  if (options.flagId) args.push("--flag-id", options.flagId);
  if (options.flagKey) args.push("--flag-key", options.flagKey);
  if (options.projectId) args.push("--project-id", options.projectId);
  args.push("--context", contextArg(options));
  if (options.seed) args.push("--seed", options.seed);
  if (options.showConfig) args.push("--show-config");
  return args;
}

// Go's CLI prints `=== label ===\n{...json...}\n` to stdout - strip the
// header line and parse the remainder as JSON.
export function parseGoOutput(stdout: string): Record<string, unknown> {
  const newlineIndex = stdout.indexOf("\n");
  const body = newlineIndex === -1 ? stdout : stdout.slice(newlineIndex + 1);
  return JSON.parse(body);
}

// Java's CLI prints human-readable `Key: Value` lines for decisions (only
// --dump emits JSON) - this is a best-effort text scrape, not a real parser,
// and will need updating if Java's CLI output format changes.
export function parseJavaOutput(stdout: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const line of stdout.split("\n")) {
    if (line.startsWith("===") || line.trim() === "") {
      continue;
    }
    const sep = line.indexOf(": ");
    if (sep === -1) {
      continue;
    }
    const key = line.slice(0, sep).trim();
    const rawValue = line.slice(sep + 2).trim();
    result[key] = rawValue === "true" ? true : rawValue === "false" ? false : rawValue;
  }
  return result;
}

export async function runGoCli(cliPath: string, options: CliOptions): Promise<CompareResult> {
  const args = buildGoArgs(options);
  const command = `${cliPath} ${args.join(" ")}`;
  try {
    const { stdout } = await execFileAsync(cliPath, args);
    return { target: "go", command, ok: true, raw: stdout, parsed: parseGoOutput(stdout) };
  } catch (error) {
    return {
      target: "go",
      command,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runJavaCli(jarPath: string, options: CliOptions): Promise<CompareResult> {
  const args = ["-jar", jarPath, ...buildJavaArgs(options)];
  const command = `java ${args.join(" ")}`;
  try {
    const { stdout } = await execFileAsync("java", args);
    return { target: "java", command, ok: true, raw: stdout, parsed: parseJavaOutput(stdout) };
  } catch (error) {
    return {
      target: "java",
      command,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// "active" is the one field guaranteed present and directly comparable
// across all three SDKs' decision shapes - Go/Java converged experiments and
// flags into a single unified Decision (id/key/variantId/variantKey/active/
// source), while TS still exposes two distinct shapes (DecisionResponse for
// experiments: treatmentId/label/control/status; FlagDecisionResponse for
// flags: variantId/variantKey/active/source). Everything else is reported
// as raw parsed output for a human/AI to eyeball rather than force-mapped
// field names that would be more misleading than helpful.
export function compareActive(
  tsResult: Record<string, unknown>,
  other: CompareResult,
): { match: boolean; tsActive: unknown; otherActive: unknown } | undefined {
  if (!other.parsed) {
    return undefined;
  }
  const otherActive = other.parsed["Active"] ?? other.parsed["active"];
  if (otherActive === undefined) {
    return undefined;
  }
  return {
    match: String(otherActive) === String(tsResult["active"]),
    tsActive: tsResult["active"],
    otherActive,
  };
}
