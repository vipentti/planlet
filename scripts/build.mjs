import { chmod } from "node:fs/promises";

import { build } from "esbuild";

const outputFile = "dist/planlet.mjs";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: outputFile,
  banner: {
    js: "#!/usr/bin/env node",
  },
});

await chmod(outputFile, 0o755);
