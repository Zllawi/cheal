import mongoose from "mongoose";
import { Redis } from "ioredis";
import { env } from "../config/env.js";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  lazyConnect: true
});

redis.on("error", (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[redis] connection error", message);
});

export async function connectRedisSafely(): Promise<void> {
  if (redis.status === "ready" || redis.status === "connecting") {
    return;
  }

  try {
    await redis.connect();
    console.log("[redis] connected");
  } catch {
    console.warn("[redis] unavailable, continuing without cache/limits");
  }
}

export async function connectMongoSafely(): Promise<void> {
  if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) {
    return;
  }

  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000
  });
  console.log("[mongo] connected");
}

export function isMongoHealthy(): boolean {
  return mongoose.connection.readyState === 1;
}
