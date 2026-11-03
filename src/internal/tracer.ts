import { _InternalDecisionTracer } from "../sdk";
import { LabsDecisionTracer, LabsTraceFields, LabsTraceLevel as TraceLevel } from "../types";
import * as uuid from "uuid";

export class Tracer implements _InternalDecisionTracer {
  public readonly traceId: string;
  constructor(
    private traceCallback: LabsDecisionTracer,
    private levelThreshold: TraceLevel,
  ) {
    this.traceId = uuid.v4();
  }

  public(level: TraceLevel, id: string, message: string, fields: LabsTraceFields): void {
    return this.trace(level, id, message, fields);
  }

  trace(level: TraceLevel, id: string, message: string, fields: LabsTraceFields): void {
    if (this.traceCallback && level >= this.levelThreshold) {
      const timestamp = new Date();
      fields["traceId"] = this.traceId;
      this.traceCallback.OnTrace(level, timestamp, id, message, fields);
    }
  }
}
