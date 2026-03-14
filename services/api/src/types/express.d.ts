import type { AuthUser } from "../modules/auth/types.js";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
