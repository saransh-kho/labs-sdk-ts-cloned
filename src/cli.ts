#!/usr/bin/env node
import { realpathSync } from "fs";
import { pathToFileURL } from "url";
import { main } from "./cli/main";

// Split from ./cli/main.ts so tests can import main() directly without ever
// loading this file - ts-jest transpiles to CommonJS for the test run
// regardless of tsconfig's ESM "module" target, and import.meta is invalid
// there.
//
// argv[1] must be resolved through realpath before comparing: npm installs the
// bin as a symlink (node_modules/.bin/labs-cli), and Node sets import.meta.url
// to the symlink *target* while argv[1] stays the symlink path. Comparing them
// raw makes the installed bin a silent no-op that exits 0 without running.
const entryPath = process.argv[1];
const isMainModule =
  entryPath !== undefined && import.meta.url === pathToFileURL(realpathSync(entryPath)).href;
if (isMainModule) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
