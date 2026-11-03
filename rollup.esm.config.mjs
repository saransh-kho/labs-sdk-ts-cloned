// True ESM *library* build target - distinct from the browser bundles
// (rollup.config.mjs), which apply Buffer/global browser polyfills a Node ESM
// consumer neither needs nor wants. Dependencies are left external (emitted as
// bare `import ... from "long"` specifiers), so this is a thin, tree-shakeable
// ESM entry that Node resolves natively via the package "exports" `import`
// condition. Internal relative imports are bundled in, which also sidesteps
// the extension-less-import problem (`import "./types"`) that plain `tsc`
// module:esnext output hits under real Node ESM resolution.
//
// Emitted as .mjs so Node treats it as ESM unconditionally, regardless of the
// package's CommonJS "type" (mirrors the convention main adopted when it
// renamed rollup.config.js -> .mjs during the ESM->CJS conversion, #134).
// getSDKVersion()'s "[VI]{version}[/VI]" placeholder is stamped by the
// post-build scripts/stamp-version.mjs pass - the single mechanism that stamps
// every output (this ESM build, the CJS tsc emit, and the browser bundles).
import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import nodeExternals from "rollup-plugin-node-externals";
import { defineConfig } from "rollup";

export default defineConfig({
  input: "src/index.ts",
  output: {
    file: "dist/esm/index.mjs",
    format: "es",
    sourcemap: true,
  },
  plugins: [
    // Keep runtime deps + node builtins external - a library ESM build should
    // not inline long/uuid/compare-versions/json-logic-engine.
    nodeExternals(),
    nodeResolve(),
    // Types are emitted once by the CJS tsc build (dist/index.d.ts); don't
    // re-emit declarations here.
    typescript({ tsconfig: "tsconfig.build.json", declaration: false, declarationMap: false }),
  ],
});
