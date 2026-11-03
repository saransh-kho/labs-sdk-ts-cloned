import { LabsDecisionTracer, LabsTraceFields, LabsTraceLevel as TraceLevel } from "../types";

// A tracer does not ned to worry about 'current level'.  If a message
// is suppressed by a level filter, it will not get here.  Changes
// to the filter level will not alter what has already been traced.

interface TraceConsole {
  error: typeof console.error;
  warn: typeof console.warn;
  info: typeof console.info;
  debug: typeof console.debug;
}
export class DefaultTracer implements LabsDecisionTracer {
  private messages: {
    message: string;
    id: string;
    fields: LabsTraceFields;
    level: TraceLevel;
    timestamp: Date;
  }[] = [];

  constructor(private logger: TraceConsole = console) {}

  OnTrace(level: TraceLevel, timestamp: Date, id: string, message: string, fields: LabsTraceFields): void {
    const logMessage = {
      message,
      id,
      fields,
      level,
      timestamp,
    };

    this.messages.push(logMessage);
  }

  flush() {
    let log: TraceConsole["info"];

    for (const logItem of this.messages) {
      let level = logItem.level;
      switch (level) {
        case TraceLevel.ERROR:
          log = this.logger.error;
          break;
        case TraceLevel.WARN:
          log = this.logger.warn;
          break;
        case TraceLevel.INFO:
          log = this.logger.info;
          break;
        case TraceLevel.DEBUG:
          log = this.logger.debug;
          break;
        default:
          level = TraceLevel.UNKNOWN;
          log = this.logger.error;
          break;
      }
      if (log) {
        log = log.bind(this.logger);
        log(
          `${TraceLevel[level]}: ${logItem.timestamp.toISOString()}: [${logItem.id}] ${logItem.message} -> `,
          logItem.fields,
        );
      }
    }
  }
}
