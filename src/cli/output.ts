import { LabsDecisionTracer, LabsTraceLevel } from "../types";

// Always clean JSON on stdout, one value per invocation - deliberately NOT
// Go's `=== label ===\n{json}` decoration or Java's human-readable
// `Key: value` lines. This CLI's whole point is to be driven by an AI/script
// probing live configs, so stdout must be directly JSON.parse-able with no
// header to strip first.
export function printResult(result: unknown): void {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

export function printError(message: string): void {
  process.stderr.write(`Error: ${message}\n`);
}

const LEVELS: Record<string, LabsTraceLevel> = {
  debug: LabsTraceLevel.DEBUG,
  info: LabsTraceLevel.INFO,
  warn: LabsTraceLevel.WARN,
  error: LabsTraceLevel.ERROR,
};

export function parseTraceLevel(name: string): LabsTraceLevel {
  const level = LEVELS[name.toLowerCase()];
  if (level === undefined) {
    throw new Error(`Unknown --trace level: ${name} (expected debug, info, warn, or error)`);
  }
  return level;
}

// Every trace event as one JSON line on stderr, so stdout stays reserved for
// the single JSON result value.
export function createStderrTracer(): LabsDecisionTracer {
  return {
    OnTrace(level, timestamp, id, message, fields) {
      process.stderr.write(
        JSON.stringify({ level: LabsTraceLevel[level], timestamp, id, message, fields }) + "\n",
      );
    },
    flush() {
      return;
    },
  };
}
