import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/jwt.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { HttpError } from "../../utils/http-error.js";
import { consumeRateLimit } from "../../utils/rate-limit.js";
import { checkBurstReporting, flagFraud } from "../fraud/service.js";
import { computeStationState } from "./verification.js";
import { CrowdReportModel, StationModel } from "../../db/models.js";
import { haversineMeters } from "../../utils/geo.js";

const router = Router();

const reportSchema = z.object({
  stationId: z.string().min(8),
  fuelStatus: z.enum(["available", "low", "unavailable", "closed"]),
  dieselStatus: z.enum(["available", "low", "unavailable"]).optional(),
  congestion: z.enum(["none", "medium", "high"]),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  imageUrl: z.string().url().optional()
});

router.post(
  "/",
  requireAuth(["station_manager", "admin"]),
  asyncHandler(async (req, res) => {
    const actor = req.user;
    if (!actor) {
      throw new HttpError(401, "Unauthorized");
    }

    const body = reportSchema.parse(req.body);
    const rate = await consumeRateLimit(`report:user:${actor.id}`, 30, 60 * 60);
    if (!rate.allowed) {
      throw new HttpError(429, "Rate limit exceeded");
    }

    const station = (await StationModel.findById(body.stationId).lean()) as any;
    if (!station) {
      throw new HttpError(404, "Station not found");
    }

    const stationLat = station.location.coordinates[1];
    const stationLng = station.location.coordinates[0];
    const distance = haversineMeters(body.lat, body.lng, stationLat, stationLng);
    if (distance > 3000) {
      throw new HttpError(422, "You are too far from this station");
    }

    const duplicate = await CrowdReportModel.findOne({
      userId: actor.id,
      stationId: body.stationId,
      createdAt: { $gte: new Date(Date.now() - 3 * 60 * 1000) }
    }).lean();
    if (duplicate) {
      throw new HttpError(409, "Duplicate report submitted too quickly");
    }

    const report = await CrowdReportModel.create({
      userId: actor.id,
      stationId: body.stationId,
      stationCity: station.city,
      fuelStatus: body.fuelStatus,
      dieselStatus: body.dieselStatus ?? undefined,
      congestion: body.congestion,
      reportLocation: {
        type: "Point",
        coordinates: [body.lng, body.lat]
      },
      distanceToStationM: distance,
      imageUrl: body.imageUrl ?? null,
      verificationState: "pending"
    });

    const isBurst = await checkBurstReporting(actor.id, body.stationId);
    if (isBurst) {
      await flagFraud({
        reportId: report._id,
        userId: actor.id,
        stationId: body.stationId,
        flagType: "burst_reporting",
        score: 0.8,
        details: { window: "1h", max: 8 }
      });
    }

    const verification = await computeStationState(body.stationId);

    res.status(201).json({
      reportId: report._id,
      verificationState: verification?.needsManualReview ? "flagged" : "pending",
      queued: false,
      verification: verification ?? null
    });
  })
);

export const reportsRouter = router;
