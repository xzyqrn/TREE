import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "fs/promises";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
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
  const nodeBuiltins = [
    "async_hooks", "buffer", "crypto", "dns", "events", "fs", "http", "http2",
    "net", "os", "path", "perf_hooks", "process", "querystring", "stream",
    "string_decoder", "tls", "tty", "url", "util", "zlib", "module"
  ];

  // Modules that definitely don't exist in Workers and need shimming
  const shimmedModules = ["tty", "net", "tls", "dns", "http2", "child_process"];
  
  const externals = [
    ...nodeBuiltins.filter(n => !shimmedModules.includes(n)),
    ...nodeBuiltins.filter(n => !shimmedModules.includes(n)).map(n => `node:${n}`),
    ...allDeps.filter((dep) => !allowlist.includes(dep))
  ];

  const aliases: Record<string, string> = {};
  for (const builtin of nodeBuiltins) {
    if (!shimmedModules.includes(builtin)) {
      aliases[builtin] = `node:${builtin}`;
    }
  }

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "esm",
    outfile: "dist/index.js",
    alias: aliases,
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire('file:///_internal_');",
    },
    plugins: [{
      name: 'node-shims',
      setup(build) {
        build.onResolve({ filter: /^(node:)?(tty|net|tls|dns|http2|child_process)$/ }, args => {
          return { path: args.path, namespace: 'node-shim' }
        })
        build.onLoad({ filter: /.*/, namespace: 'node-shim' }, args => {
          if (args.path.includes('tty')) {
            return { contents: 'export const isatty = () => false; export default { isatty };', loader: 'js' }
          }
          return { contents: 'export default {};', loader: 'js' }
        })
      }
    }],
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: false,
    external: externals,
    logLevel: "info",
    mainFields: ["module", "main"],
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
