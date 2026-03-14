import express from "express";
import cors from "cors";
import helmet from "helmet";
import { ZodError } from "zod";
import { allowedOrigins, env } from "./config/env.js";
import { connectMongoSafely, connectRedisSafely, isMongoHealthy } from "./db/pool.js";
import { HttpError } from "./utils/http-error.js";
import { optionalAuth } from "./modules/auth/jwt.js";
import { authRouter } from "./modules/auth/router.js";
import { stationsRouter } from "./modules/stations/router.js";
import { reportsRouter } from "./modules/reports/router.js";
import { predictionsRouter } from "./modules/predictions/router.js";
import { notificationsRouter } from "./modules/notifications/router.js";
import { analyticsRouter } from "./modules/analytics/router.js";
import { realtimeRouter } from "./modules/realtime/router.js";
import { supportRouter } from "./modules/support/router.js";

const app = express();

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return true;
  }

  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4Match) {
    return false;
  }

  const octets = ipv4Match.slice(1).map((segment) => Number(segment));
  if (octets.some((segment) => Number.isNaN(segment) || segment < 0 || segment > 255)) {
    return false;
  }

  const [first, second] = octets;
  if (first === 10 || first === 127) {
    return true;
  }
  if (first === 192 && second === 168) {
    return true;
  }
  if (first === 172 && second >= 16 && second <= 31) {
    return true;
  }

  return false;
}

function isAllowedCorsOrigin(origin: string): boolean {
  const normalizedOrigin = normalizeOrigin(origin);
  if (allowedOrigins.includes(normalizedOrigin)) {
    return true;
  }

  // In development, allow local/LAN web clients without editing ALLOWED_ORIGIN for every IP change.
  if (env.NODE_ENV !== "production") {
    try {
      const { hostname } = new URL(normalizedOrigin);
      if (isPrivateOrLocalHostname(hostname)) {
        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
}

app.disable("x-powered-by");
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (isAllowedCorsOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new HttpError(403, `Origin ${origin} is not allowed by CORS`));
    },
    credentials: true
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(optionalAuth);

app.get("/health", async (_req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    dependencies: {
      db: isMongoHealthy()
    }
  });
});

app.use("/auth", authRouter);
app.use("/stations", stationsRouter);
app.use("/reports", reportsRouter);
app.use("/predictions", predictionsRouter);
app.use("/notifications", notificationsRouter);
app.use("/analytics", analyticsRouter);
app.use("/support", supportRouter);
app.use("/", realtimeRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "ValidationError",
      message: "Invalid request payload",
      details: err.flatten()
    });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.statusCode).json({
      error: "HttpError",
      message: err.message,
      details: err.details ?? null
    });
    return;
  }

  console.error(err);
  res.status(500).json({
    error: "InternalServerError",
    message: "Unexpected server error"
  });
});

async function bootstrap(): Promise<void> {
  await connectMongoSafely();
  await connectRedisSafely();

  app.listen(env.API_PORT, env.API_HOST, () => {
    console.log(`API listening on http://${env.API_HOST}:${env.API_PORT}`);
  });
}

void bootstrap();
