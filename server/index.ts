import { createHonoApp } from "./routes-hono";

export function log(message: string, source = "hono") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

// Create the Hono app (works on both Node.js and Cloudflare Workers)
const app = createHonoApp();

// Cloudflare Workers: export default fetch handler
// Node.js dev: start a local server via @hono/node-server
if (typeof process !== "undefined" && process.env.PORT) {
  // Running locally with explicit PORT – start an HTTP server
  const PORT = parseInt(process.env.PORT || "5000", 10);
  const { serve } = await import("@hono/node-server");
  serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, (info) => {
    log(`serving on port ${info.port}`);
  });
} else if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
  // Dev mode without PORT – use Vite middleware via node-server
  const { createServer } = await import("http");
  const { serve } = await import("@hono/node-server");
  const PORT = parseInt(process.env.DEV_PORT || "5000", 10);
  // For dev purposes use the vite middleware wrapped app
  // We still need to set up Vite for HMR and serving the client in dev
  const express = (await import("express")).default;
  const expressApp = express();
  const httpServer = createServer(expressApp);
  // Mount Hono API routes on Express for dev
  expressApp.use(async (req, res, next) => {
    if (req.path.startsWith("/api")) {
      try {
        // Forward to Hono
        const hasBody = !["GET", "HEAD"].includes(req.method);
        const requestInit: RequestInit & { duplex?: "half" } = {
          method: req.method,
          headers: req.headers as any,
        };
        if (hasBody) {
          requestInit.body = req as any;
          requestInit.duplex = "half";
        }
        const request = new Request(`http://localhost${req.url}`, requestInit);
        const honoRes = await app.fetch(request);
        res.status(honoRes.status);
        honoRes.headers.forEach((val, key) => res.setHeader(key, val));
        const text = await honoRes.text();
        res.send(text);
      } catch (error) {
        if (res.headersSent) {
          next(error);
          return;
        }
        res.status(500).json({
          error: error instanceof Error ? error.message : "Local API proxy failed",
        });
      }
    } else {
      next();
    }
  });
  const { setupVite } = await import("./vite");
  await setupVite(httpServer, expressApp);
  httpServer.listen(PORT, "0.0.0.0", () => {
    log(`serving on port ${PORT}`);
  });
}

export default app;
