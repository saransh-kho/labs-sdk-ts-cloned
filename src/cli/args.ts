// Hand-rolled argv parsing, deliberately dependency-free (mirrors Go's own
// minimal stdlib `flag` package) so the CLI doesn't force a new runtime
// dependency onto every consumer of the library (any "dependencies" entry
// gets installed for everyone, whether or not they ever touch the CLI).

export type CompareTarget = "go" | "java";

export type CliOptions = {
  help: boolean;
  environment?: string;
  fetchUrl?: string;
  trackUrl?: string;
  flagFetchUrl?: string;
  expId?: string;
  flagId?: string;
  flagKey?: string;
  projectId?: string;
  context?: string;
  seed?: string;
  showConfig: boolean;
  track: boolean; // opt-in to real tracking; default is a null: sink so probing never pollutes analytics
  traceLevel?: string;
  timeoutMs?: number;
  compare: CompareTarget[];
  goCliPath?: string;
  javaCliJar?: string;
};

function defaultOptions(): CliOptions {
  return {
    help: false,
    showConfig: false,
    track: false,
    compare: [],
  };
}

export function parseArgs(argv: string[]): CliOptions {
  const options = defaultOptions();

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    let flag = arg;
    let inlineValue: string | undefined;

    const eq = arg.indexOf("=");
    if (arg.startsWith("--") && eq !== -1) {
      flag = arg.slice(0, eq);
      inlineValue = arg.slice(eq + 1);
    }

    const takeValue = (): string => {
      if (inlineValue !== undefined) {
        return inlineValue;
      }
      const next = argv[i + 1];
      if (next === undefined) {
        throw new Error(`Missing value for ${flag}`);
      }
      i++;
      return next;
    };

    switch (flag) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--env":
      case "--environment":
        options.environment = takeValue();
        break;
      case "--fetch-url":
        options.fetchUrl = takeValue();
        break;
      case "--track-url":
        options.trackUrl = takeValue();
        break;
      case "--flag-fetch-url":
        options.flagFetchUrl = takeValue();
        break;
      case "--id":
      case "--exp-id":
        options.expId = takeValue();
        break;
      case "--flag-id":
        options.flagId = takeValue();
        break;
      case "--flag-key":
        options.flagKey = takeValue();
        break;
      case "--project-id":
        options.projectId = takeValue();
        break;
      case "--context":
        options.context = takeValue();
        break;
      case "--seed":
        options.seed = takeValue();
        break;
      case "--show-config":
        options.showConfig = true;
        break;
      case "--track":
        options.track = true;
        break;
      case "--trace":
      case "-v":
        options.traceLevel = takeValue();
        break;
      case "--timeout-ms":
        options.timeoutMs = Number(takeValue());
        break;
      case "--compare": {
        const value = takeValue();
        options.compare = value
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter((s): s is CompareTarget => s === "go" || s === "java");
        break;
      }
      case "--go-cli-path":
        options.goCliPath = takeValue();
        break;
      case "--java-cli-jar":
        options.javaCliJar = takeValue();
        break;
      default:
        throw new Error(`Unknown flag: ${flag}`);
    }
    i++;
  }

  return options;
}
