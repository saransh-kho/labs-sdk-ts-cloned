// Post-build: stamp the real package version into getSDKVersion()'s
// "[VI]{version}[/VI]" placeholder across every emitted JS/MJS artifact.
//
// This is the *single* version-stamping mechanism for the whole package. A
// rollup plugin can't do the job alone: the CJS entry is a plain `tsc` emit
// that no rollup plugin ever touches. A build-tool-agnostic post-build pass
// can, so it owns all outputs uniformly - the CJS tsc emit, the ESM .mjs
// build, and the browser bundles - and every entry point reports the same
// version. (Without stamping, consumers saw the literal "[VI]{version}[/VI]".)
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const PLACEHOLDER = "[VI]{version}[/VI]";

let stamped = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path);
      continue;
    }
    if (!/\.(mjs|js)$/.test(name)) {
      continue;
    }
    const source = readFileSync(path, "utf8");
    if (!source.includes(PLACEHOLDER)) {
      continue;
    }
    writeFileSync(path, source.split(PLACEHOLDER).join(version));
    stamped++;
  }
}

walk(join(root, "dist"));
console.log(`stamp-version: ${version} -> ${stamped} file(s)`);
