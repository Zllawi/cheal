import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/async-handler.js";
import { HttpError } from "../../utils/http-error.js";
import { signAccessToken, requireAuth } from "./jwt.js";
import type { AppRole } from "./types.js";
import { TrustScoreModel, UserModel } from "../../db/models.js";
import { env } from "../../config/env.js";
import { hashPassword, verifyPassword } from "./password.js";

const router = Router();

const registerSchema = z.object({
  fullName: z.string().min(2),
  phone: z.string().min(8),
  address: z.string().min(3),
  password: z.string().min(8),
  city: z.string().optional()
});

const loginSchema = z.object({
  phone: z.string().min(8),
  password: z.string().min(8)
});

const devLoginSchema = z.object({
  phone: z.string().min(8).optional(),
  role: z.enum(["user", "station_manager", "admin"]).default("user"),
  name: z.string().min(2).default("FuelMap User"),
  city: z.string().optional()
});

const adminPhones = parsePhoneList(env.ADMIN_PHONES);
const editorPhones = parsePhoneList(env.EDITOR_PHONES);

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const payload = registerSchema.parse(req.body);
    const phone = normalizePhone(payload.phone);
    const city = payload.city ?? "Tripoli";

    const role = computeRoleByPhone(phone);
    const passwordHash = await hashPassword(payload.password);
    const existing = (await UserModel.findOne({ phoneE164: phone }).lean()) as any;

    let created: any;
    if (existing) {
      if (existing.passwordHash) {
        throw new HttpError(409, "Phone already registered");
      }

      await UserModel.updateOne(
        { _id: existing._id },
        {
          $set: {
            fullName: payload.fullName,
            address: payload.address,
            passwordHash,
            role,
            city
          }
        }
      );
      created = (await UserModel.findById(existing._id).lean()) as any;
    } else {
      const newUser = await UserModel.create({
        phoneE164: phone,
        fullName: payload.fullName,
        address: payload.address,
        passwordHash,
        role,
        city
      });
      created = newUser.toObject();
    }

    await TrustScoreModel.updateOne(
      { userId: created._id },
      {
        $setOnInsert: {
          userId: created._id,
          score: 50,
          totalReports: 0,
          acceptedReports: 0,
          rejectedReports: 0
        }
      },
      { upsert: true }
    );

    const token = signAccessToken({
      id: String(created._id),
      role,
      city: created.city ?? null
    });

    res.status(201).json({
      accessToken: token,
      user: {
        id: String(created._id),
        role,
        city: created.city ?? null,
        fullName: created.fullName,
        phoneE164: created.phoneE164,
        address: created.address ?? null
      }
    });
  })
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const payload = loginSchema.parse(req.body);
    const phone = normalizePhone(payload.phone);

    const user = (await UserModel.findOne({ phoneE164: phone }).lean()) as any;
    if (!user || !user.passwordHash) {
      throw new HttpError(401, "Invalid phone or password");
    }
    if (user.isActive === false) {
      throw new HttpError(403, "Account disabled");
    }

    const validPassword = await verifyPassword(payload.password, user.passwordHash);
    if (!validPassword) {
      throw new HttpError(401, "Invalid phone or password");
    }

    const computedRole = computeRoleByPhone(phone);
    const role = (user.role ?? computedRole) as AppRole;
    if (role !== user.role) {
      await UserModel.updateOne({ _id: user._id }, { $set: { role } });
    }

    const token = signAccessToken({
      id: String(user._id),
      role,
      city: user.city ?? null
    });

    res.json({
      accessToken: token,
      user: {
        id: String(user._id),
        role,
        city: user.city ?? null,
        fullName: user.fullName,
        phoneE164: user.phoneE164,
        address: user.address ?? null
      }
    });
  })
);

router.post(
  "/logout",
  requireAuth(["user", "station_manager", "admin"]),
  asyncHandler(async (_req, res) => {
    res.json({ ok: true });
  })
);

router.get(
  "/me",
  requireAuth(["user", "station_manager", "admin"]),
  asyncHandler(async (req, res) => {
    const actor = req.user;
    if (!actor) {
      throw new HttpError(401, "Unauthorized");
    }

    const user = (await UserModel.findById(actor.id).lean()) as any;
    if (!user || user.isActive === false) {
      throw new HttpError(401, "Unauthorized");
    }

    const phone = normalizePhone(user.phoneE164 ?? "");
    const computedRole = phone ? computeRoleByPhone(phone) : (user.role as AppRole);
    const role = (user.role ?? computedRole) as AppRole;

    if (computedRole !== role) {
      await UserModel.updateOne({ _id: user._id }, { $set: { role: computedRole } });
    }

    res.json({
      user: {
        id: String(user._id),
        role: computedRole,
        city: user.city ?? null,
        fullName: user.fullName,
        phoneE164: user.phoneE164 ?? null,
        address: user.address ?? null
      }
    });
  })
);

router.post(
  "/dev-login",
  asyncHandler(async (req, res) => {
    if (env.DEV_AUTH_ENABLED.toLowerCase() !== "true") {
      throw new HttpError(404, "Not found");
    }

    const payload = devLoginSchema.parse(req.body);
    const role = payload.role as AppRole;
    const city = payload.city ?? "Tripoli";
    const phone = payload.phone
      ? normalizePhone(payload.phone)
      : `+2189${Math.floor(10000000 + Math.random() * 89999999)}`;

    let user = (await UserModel.findOne({ phoneE164: phone }).lean()) as any;
    if (!user) {
      const created = await UserModel.create({
        phoneE164: phone,
        fullName: payload.name,
        role,
        city
      });
      user = created.toObject();
    } else if (user.role !== role) {
      await UserModel.updateOne({ _id: user._id }, { $set: { role, city, fullName: payload.name } });
      user = { ...user, role, city, fullName: payload.name };
    }

    await TrustScoreModel.updateOne(
      { userId: user._id },
      {
        $setOnInsert: {
          userId: user._id,
          score: 50,
          totalReports: 0,
          acceptedReports: 0,
          rejectedReports: 0
        }
      },
      { upsert: true }
    );

    const token = signAccessToken({
      id: String(user._id),
      role,
      city: user.city ?? null
    });

    res.json({
      accessToken: token,
      user: {
        id: String(user._id),
        role,
        city: user.city ?? null,
        fullName: user.fullName,
        phoneE164: user.phoneE164 ?? null,
        address: user.address ?? null
      }
    });
  })
);

export const authRouter = router;

function parsePhoneList(value: string): Set<string> {
  if (!value.trim()) {
    return new Set<string>();
  }

  return new Set(
    value
      .split(",")
      .map((item) => normalizePhone(item))
      .filter((item) => item.length > 0)
  );
}

function normalizePhone(raw: string): string {
  const latinized = raw
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));

  let value = latinized
    .trim()
    .replace(/[\s\-()]/g, "")
    .replace(/[\u200e\u200f]/g, "");

  if (value.startsWith("00")) {
    value = `+${value.slice(2)}`;
  }
  if (!value.startsWith("+") && value.startsWith("218")) {
    value = `+${value}`;
  }
  if (!value.startsWith("+") && value.startsWith("0")) {
    value = `+218${value.slice(1)}`;
  }
  if (value && !value.startsWith("+")) {
    value = `+${value}`;
  }

  return value;
}

function computeRoleByPhone(phone: string): AppRole {
  if (adminPhones.has(phone)) {
    return "admin";
  }
  if (editorPhones.has(phone)) {
    return "station_manager";
  }
  return "user";
}
