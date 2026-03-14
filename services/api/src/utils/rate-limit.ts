import { redis } from "../db/pool.js";

const memoryStore = new Map<string, { count: number; expiresAt: number }>();

export async function consumeRateLimit(
  key: string,
  max: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number }> {
  const now = Date.now();
  const ttlMs = windowSeconds * 1000;

  if (redis.status === "ready") {
    const redisKey = `ratelimit:${key}`;
    const value = await redis.incr(redisKey);
    if (value === 1) {
      await redis.expire(redisKey, windowSeconds);
    }
    return {
      allowed: value <= max,
      remaining: Math.max(0, max - value)
    };
  }

  const state = memoryStore.get(key);
  if (!state || state.expiresAt < now) {
    memoryStore.set(key, { count: 1, expiresAt: now + ttlMs });
    return { allowed: true, remaining: max - 1 };
  }

  state.count += 1;
  return {
    allowed: state.count <= max,
    remaining: Math.max(0, max - state.count)
  };
}
