import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/jwt.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { HttpError } from "../../utils/http-error.js";
import { NotificationPreferenceModel } from "../../db/models.js";

const router = Router();

const subscribeSchema = z.object({
  city: z.string().max(80).optional(),
  maxRadiusKm: z.number().int().min(1).max(50).default(10),
  notifyGasoline: z.boolean().default(true),
  notifyDiesel: z.boolean().default(true),
  notifyHighCongestion: z.boolean().default(true),
  pushEnabled: z.boolean().default(true)
});

router.post(
  "/subscribe",
  requireAuth(["user", "station_manager", "admin"]),
  asyncHandler(async (req, res) => {
    const actor = req.user;
    if (!actor) {
      throw new HttpError(401, "Unauthorized");
    }

    const payload = subscribeSchema.parse(req.body);

    const preference = (await NotificationPreferenceModel.findOneAndUpdate(
      { userId: actor.id },
      {
        $set: {
          city: payload.city ?? actor.city ?? null,
          maxRadiusKm: payload.maxRadiusKm,
          notifyGasoline: payload.notifyGasoline,
          notifyDiesel: payload.notifyDiesel,
          notifyHighCongestion: payload.notifyHighCongestion,
          pushEnabled: payload.pushEnabled
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean()) as any;

    res.json({
      userId: preference?.userId,
      city: preference?.city ?? null,
      maxRadiusKm: preference?.maxRadiusKm ?? 10,
      notifyGasoline: preference?.notifyGasoline ?? true,
      notifyDiesel: preference?.notifyDiesel ?? true,
      notifyHighCongestion: preference?.notifyHighCongestion ?? true,
      pushEnabled: preference?.pushEnabled ?? true,
      updatedAt: preference?.updatedAt ?? new Date()
    });
  })
);

export const notificationsRouter = router;
