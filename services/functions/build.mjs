// Bundles each handler into dist/<name>/index.mjs. Terraform zips each folder.
import { build } from "esbuild";
import { readdirSync, rmSync } from "node:fs";

const handlers = readdirSync("src/handlers").filter((f) => f.endsWith(".ts"));
rmSync("dist", { recursive: true, force: true });

await Promise.all(
  handlers.map((file) =>
    build({
      entryPoints: [`src/handlers/${file}`],
      outfile: `dist/${file.replace(/\.ts$/, "")}/index.mjs`,
      bundle: true,
      platform: "node",
      target: "node22",
      format: "esm",
      minify: true,
      sourcemap: false,
      // Bundled SDK clients still need `require` for a few CJS internals.
      banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
    }),
  ),
);
console.log(`built ${handlers.length} handlers: ${handlers.join(", ")}`);
