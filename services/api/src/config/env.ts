import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const envCandidates = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "..", ".env"),
  resolve(process.cwd(), "..", "..", ".env"),
  resolve(__dirname, "..", "..", "..", ".env"),
  resolve(__dirname, "..", "..", "..", "..", ".env")
];

for (const candidate of envCandidates) {
  if (existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

const envSchema = z.object({
  API_PORT: z.coerce.number().default(4000),
  API_HOST: z.string().default("0.0.0.0"),
  MONGODB_URI: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  JWT_SECRET: z.string().min(12, "JWT_SECRET must be at least 12 chars"),
  ALLOWED_ORIGIN: z.string().default("http://localhost:3000"),
  AI_SERVICE_URL: z.string().default("http://localhost:8000"),
  DEV_AUTH_ENABLED: z.string().default("false"),
  EDITOR_PHONES: z.string().default(""),
  ADMIN_PHONES: z.string().default("")
});

export const env = envSchema.parse(process.env);
