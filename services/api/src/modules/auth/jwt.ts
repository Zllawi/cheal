import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { HttpError } from "../../utils/http-error.js";
import type { AppRole, AuthUser } from "./types.js";

const tokenPayloadSchema = z.object({
  sub: z.string().min(8),
  role: z.enum(["user", "station_manager", "admin"]),
  city: z.string().optional()
});

export function signAccessToken(payload: AuthUser): string {
  return jwt.sign(
    {
      sub: payload.id,
      role: payload.role,
      city: payload.city ?? undefined
    },
    env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function parseAuthorizationHeader(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice(7);
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = parseAuthorizationHeader(req);
  if (!token) {
    next();
    return;
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    const parsed = tokenPayloadSchema.parse(decoded);
    req.user = {
      id: parsed.sub,
      role: parsed.role,
      city: parsed.city ?? null
    };
    next();
  } catch {
    next();
  }
}

export function requireAuth(roles?: AppRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const token = parseAuthorizationHeader(req);
    if (!token) {
      next(new HttpError(401, "Missing access token"));
      return;
    }

    try {
      const decoded = jwt.verify(token, env.JWT_SECRET);
      const parsed = tokenPayloadSchema.parse(decoded);
      const user: AuthUser = {
        id: parsed.sub,
        role: parsed.role,
        city: parsed.city ?? null
      };

      if (roles && !roles.includes(user.role)) {
        next(new HttpError(403, "Forbidden"));
        return;
      }

      req.user = user;
      next();
    } catch {
      next(new HttpError(401, "Invalid or expired access token"));
    }
  };
}
