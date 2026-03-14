import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scryptCallback);

const KEY_LEN = 64;
const SALT_LEN = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const hash = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, saltHex, hashHex] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltHex || !hashHex) {
    return false;
  }

  const salt = Buffer.from(saltHex, "hex");
  const expectedHash = Buffer.from(hashHex, "hex");
  const computedHash = (await scryptAsync(password, salt, expectedHash.length)) as Buffer;

  if (expectedHash.length !== computedHash.length) {
    return false;
  }

  return timingSafeEqual(expectedHash, computedHash);
}
