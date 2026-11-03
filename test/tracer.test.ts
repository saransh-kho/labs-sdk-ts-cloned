import { DefaultTracer } from "../src/internal/default_tracer";
import { LabsTraceFields, LabsTraceLevel } from "../src/types";

class TestLogger {
  debug(msg: string, fields: LabsTraceFields) {
    expect(fields.level).toBe(LabsTraceLevel.DEBUG);
    this.debugs++;
  }
  info(msg: string, fields: LabsTraceFields) {
    expect(fields.level).toBe(LabsTraceLevel.INFO);
    this.infos++;
  }
  warn(msg: string, fields: LabsTraceFields) {
    expect(fields.level).toBe(LabsTraceLevel.WARN);
    this.warnings++;
  }
  error(msg: string, fields: LabsTraceFields) {
    expect(fields.level).toBeGreaterThanOrEqual(LabsTraceLevel.ERROR);
    this.errors++;
  }

  debugs = 0;
  infos = 0;
  warnings = 0;
  errors = 0;
}

[
  {
    level: LabsTraceLevel.DEBUG,
    message: "debug message",
    expect: { debugs: 1 },
  },
  {
    level: LabsTraceLevel.INFO,
    message: "info message",
    expect: { infos: 1 },
  },
  {
    level: LabsTraceLevel.WARN,
    message: "warn message",
    expect: { warnings: 1 },
  },
  {
    level: LabsTraceLevel.ERROR,
    message: "error message",
    expect: { errors: 1 },
  },
  {
    level: LabsTraceLevel.UNKNOWN,
    message: "unknown message",
    expect: { errors: 1 },
  },
  {
    level: LabsTraceLevel.SUPPRESS_TRACING, // not ever supposed to actually get sent
    message: "suppress (or not) message",
    expect: { errors: 1 },
  },
].forEach((testCase) => {
  test(`Tracer traces ${LabsTraceLevel[testCase.level]} correctly`, () => {
    const logger = new TestLogger();
    const tracer = new DefaultTracer(logger);
    const empty = { errors: 0, warnings: 0, infos: 0, debugs: 0 };

    tracer.OnTrace(testCase.level, new Date(0), LabsTraceLevel[testCase.level], testCase.message, {
      level: testCase.level,
    });
    expect(logger).toMatchObject(empty);
    tracer.flush();
    expect(logger).toMatchObject({ ...empty, ...testCase.expect });
  });
});
