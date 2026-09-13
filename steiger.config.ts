import { defineConfig } from "steiger";
import fsd from "@feature-sliced/steiger-plugin";

// components/, hooks/, and lib/ are pinned by components.json (shadcn's
// registry aliases) -- they are the de-facto shared/ui and shared/lib but
// can't move without breaking `shadcn add`. index.html/index.css/store.ts/
// app.tsx are app-shell files with no natural FSD home.
export default defineConfig([
  ...fsd.configs.recommended,
  {
    ignores: [
      "./src/ui/components/**",
      "./src/ui/hooks/**",
      "./src/ui/lib/**",
      "./src/ui/index.html",
      "./src/ui/index.css",
      "./src/ui/store.ts",
      "./src/ui/app.tsx",
    ],
  },
]);
