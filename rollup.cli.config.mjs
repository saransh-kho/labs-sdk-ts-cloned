// Separate output target for the CLI (src/cli.ts) - deliberately not part of
// rollup.config.js's browser dev/prod bundles, which apply Buffer/global
// polyfills the CLI (Node-only) doesn't need and shouldn't carry.
//
// Bundling (rather than a plain tsc emit) is required here, not optional:
// this package ships ESM with extension-less relative imports
// (`import ... from "./types"`), which plain Node ESM resolution rejects
// outright (`ERR_MODULE_NOT_FOUND`) unless something bundles/rewrites them.
// The library's own dist/index.js has this same latent issue for any
// consumer who imports it directly under plain Node without a bundler in
// front of it - out of scope to fix here, but worth knowing about.
import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import nodeExternals from "rollup-plugin-node-externals";
import { defineConfig } from "rollup";

export default defineConfig({
  input: "src/cli.ts",
  output: {
    // No banner here: src/cli.ts's own shebang line survives the TypeScript
    // compile and lands in the bundle already - adding a banner would
    // duplicate it (Node only special-cases a shebang on line 1, so a
    // second one is a syntax error).
    file: "dist/cli.mjs",
    format: "es",
    sourcemap: true,
  },
  plugins: [
    // Keep Node builtins (child_process, url, util) external - not bundled,
    // resolved from the Node runtime as usual.
    nodeExternals(),
    nodeResolve(),
    typescript({ tsconfig: "tsconfig.cli.json" }),
  ],
});
