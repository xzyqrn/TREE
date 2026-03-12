import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "fs/promises";

// Packages that should be bundled INTO the worker (they are safe / pure-JS)
const allowlist = [
  "@google/generative-ai",
  "axios",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "hono",
  "@hono/node-server",
  "nanoid",
  "openai",
  "uuid",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];

  // All Node.js built-ins — Cloudflare supplies these via nodejs_compat
  const nodeBuiltins = [
    "async_hooks", "buffer", "crypto", "dns", "events", "fs", "http", "http2",
    "net", "os", "path", "perf_hooks", "process", "querystring", "stream",
    "string_decoder", "tls", "tty", "url", "util", "zlib", "module",
  ];

  const externals = [
    ...nodeBuiltins,
    ...nodeBuiltins.map((n) => `node:${n}`),
    ...allDeps.filter((dep) => !allowlist.includes(dep)),
  ];

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "browser",
    conditions: ["worker", "browser", "import", "module"],
    bundle: true,
    format: "esm",
    outfile: "dist/index.js",
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.PORT": "undefined",
    },
    minify: false,
    external: externals,
    logLevel: "info",
    mainFields: ["worker", "module", "browser", "main"],
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
