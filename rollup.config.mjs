// Contents of the file /rollup.config.js
import typescript from "@rollup/plugin-typescript";
import alias from "@rollup/plugin-alias";
import terser from "@rollup/plugin-terser";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import inject from "@rollup/plugin-inject";
import { defineConfig } from "rollup";
import _ from "lodash";

const config = defineConfig({
  input: 'src/index.ts',
  output: {
    format: 'es',
    intro:
      // This hack is because the Buffer polyfill thinks it should be able to look at 'global'
      // which exists in node and webpack builds.  Rollup does not provide/mock an empty global
      // This intro creates a variable 'global' if it is missing and there is a 'window' to bind
      // it to - so as to not break the package as a node module, but be browser compatible.
      "typeof window !== 'undefined' && typeof global == 'undefined' && (window.global = window)",
  },
  plugins: [
    // compile
    typescript({ tsconfig: 'tsconfig.build.json' }),
    // Generate 'import Buffer from 'buffer-es6' for any usages of "buffer"
    inject({ Buffer: ['buffer-es6', 'Buffer'] }),
    // Resolve node_module references as Node does.  Export in a browser compatible manner
    nodeResolve({
      preferBuiltins: false,
      browser: true,
    }),
    // Any existing direct imports of buffer are to be resolved to buffer-es6.
    // Both alias and inject are needed to catch all cases.
    alias({
      entries: {
        buffer: 'buffer-es6',  // wholly self contained polyfill for buffer
      },
    }),
    // getSDKVersion()'s "[VI]{version}[/VI]" placeholder is stamped by the
    // post-build scripts/stamp-version.mjs pass, which is the single mechanism
    // for every output (this browser bundle, the CJS tsc emit, and the ESM
    // build) - see that script for why a rollup plugin can't cover them all.
  ],
});

// Use the main config as a base.  Merge in dev and prod unique values
// leveraging rollups ability to pass arbitrary flags through if those
// flags match the pattern: --config*. npm run build-prod used --configProd
export default (commandLineArgs) => {
  if (commandLineArgs.configProd === true) {
    return _.merge({}, config, {
      output: {
        file: 'dist/labs-sdk-prod.js',
        sourcemap: true,
      },
      plugins: [terser()],
    });
  }
  return _.merge({}, config, {
    output: {
      file: 'dist/labs-sdk-dev.js',
      sourcemap: 'inline',
    },
  });
};
