import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { createServer as createNetServer } from "net";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

function isPortInUseError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EADDRINUSE";
}

async function canListenOnPort(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createNetServer();

    probe.once("error", () => {
      resolve(false);
    });

    probe.once("listening", () => {
      probe.close(() => resolve(true));
    });

    probe.listen(port, host);
  });
}

async function resolveListenPort() {
  const host = "0.0.0.0";
  const requestedPort = parseInt(process.env.PORT || "5000", 10);
  const isProduction = process.env.NODE_ENV === "production";
  const hasExplicitPort = typeof process.env.PORT === "string" && process.env.PORT.length > 0;

  if (isProduction || hasExplicitPort) {
    return { host, port: requestedPort, usedFallback: false };
  }

  for (let port = requestedPort; port < requestedPort + 50; port += 1) {
    if (await canListenOnPort(port, host)) {
      return { host, port, usedFallback: port !== requestedPort };
    }
  }

  throw new Error(`No open development port found between ${requestedPort} and ${requestedPort + 49}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        if (path.startsWith("/api/world")) {
          logLine += " :: [world payload]";
        } else {
          const serialized = JSON.stringify(capturedJsonResponse);
          logLine += ` :: ${serialized.length > 320 ? `${serialized.slice(0, 320)}...` : serialized}`;
        }
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const { host, port, usedFallback } = await resolveListenPort();

  try {
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen({ port, host }, () => {
        httpServer.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    if (isPortInUseError(error)) {
      throw new Error(`Port ${port} is already in use. Set PORT explicitly to override the auto-selected development port.`);
    }
    throw error;
  }

  if (usedFallback) {
    log(`port 5000 was busy, using http://localhost:${port} instead`);
  }
  log(`serving on port ${port}`);
})();
