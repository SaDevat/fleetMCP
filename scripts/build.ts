#!/usr/bin/env bun
// Compiles the CLI to a single binary. `bun build --compile` has no CLI flag
// for plugins, so this goes through the Bun.build() JS API instead, which
// does accept `plugins`.
import tailwind from "bun-plugin-tailwind";

const result = await Bun.build({
  entrypoints: ["src/index.ts"],
  plugins: [tailwind],
  compile: {
    outfile: "dist/fleetmcp",
  },
});

if (!result.success) {
  for (const message of result.logs) {
    console.error(message);
  }
  process.exit(1);
}

console.log("Built dist/fleetmcp");
