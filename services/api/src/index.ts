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

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS`));
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
