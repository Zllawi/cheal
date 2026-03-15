import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/jwt.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { HttpError } from "../../utils/http-error.js";
import { realtimeBroker } from "../realtime/broker.js";
import { ModelPredictionModel, StationModel, StationOfficialUpdateModel, StationStatusHistoryModel } from "../../db/models.js";
import { haversineMeters } from "../../utils/geo.js";

const router = Router();

const listQuerySchema = z.object({
  city: z.string().optional(),
  fuelStatus: z.enum(["available", "low", "unavailable", "closed"]).optional(),
  congestion: z.enum(["none", "medium", "high"]).optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0)
});

function extractStationCoordinates(station: any): { lat: number; lng: number } | null {
  const coordinates = station?.location?.coordinates;
  if (Array.isArray(coordinates) && coordinates.length >= 2) {
    const lng = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }

  const lat = Number(station?.lat);
  const lng = Number(station?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }

  return null;
}

function stationToDto(station: any) {
  const coordinates = extractStationCoordinates(station);
  if (!coordinates) {
    return null;
  }

  return {
    id: station._id,
    osmId: station.osmId ?? null,
    name: station.name,
    city: station.city,
    address: station.address,
    supportsGasoline: station.supportsGasoline,
    supportsDiesel: station.supportsDiesel,
    fuelStatus: station.currentFuelStatus,
    dieselStatus: station.currentDieselStatus ?? "unavailable",
    congestion: station.currentCongestion,
    confidence: station.currentConfidence ?? 0,
    lastVerifiedAt: station.lastVerifiedAt ?? null,
    lat: coordinates.lat,
    lng: coordinates.lng
  };
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const filter: Record<string, unknown> = { isActive: true };

    if (query.city) {
      filter.city = query.city;
    }
    if (query.fuelStatus) {
      filter.currentFuelStatus = query.fuelStatus;
    }
    if (query.congestion) {
      filter.currentCongestion = query.congestion;
    }

    const stations = (await StationModel.find(filter)
      .sort({ updatedAt: -1 })
      .skip(query.offset)
      .limit(query.limit)
      .lean()) as any[];

    const items = stations.map(stationToDto).filter((item): item is NonNullable<typeof item> => item !== null);

    res.json({
      items,
      count: items.length
    });
  })
);

router.get(
  "/nearby",
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        lat: z.coerce.number().min(-90).max(90),
        lng: z.coerce.number().min(-180).max(180),
        radiusKm: z.coerce.number().min(1).max(50).default(10),
        fuelType: z.enum(["gasoline", "diesel"]).optional(),
        limit: z.coerce.number().min(1).max(100).default(25)
      })
      .parse(req.query);

    const radiusMeters = query.radiusKm * 1000;
    const baseFilter: Record<string, unknown> = { isActive: true };
    if (query.fuelType === "gasoline") {
      baseFilter.supportsGasoline = true;
    }
    if (query.fuelType === "diesel") {
      baseFilter.supportsDiesel = true;
    }

    const stations = await StationModel.aggregate<any>([
      {
        $geoNear: {
          near: { type: "Point", coordinates: [query.lng, query.lat] },
          distanceField: "distanceMeters",
          spherical: true,
          maxDistance: radiusMeters,
          query: baseFilter
        }
      },
      { $sort: { distanceMeters: 1 } },
      { $limit: query.limit }
    ]);

    const items = stations
      .map((station) => {
        const coordinates = extractStationCoordinates(station);
        if (!coordinates) {
          return null;
        }

        return {
          stationId: station._id,
          name: station.name,
          city: station.city,
          supportsGasoline: station.supportsGasoline,
          supportsDiesel: station.supportsDiesel,
          fuelStatus: station.currentFuelStatus,
          dieselStatus: station.currentDieselStatus ?? "unavailable",
          congestion: station.currentCongestion,
          confidence: station.currentConfidence ?? 0,
          lastVerifiedAt: station.lastVerifiedAt ?? null,
          distanceMeters: Math.round(station.distanceMeters),
          lat: coordinates.lat,
          lng: coordinates.lng
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    res.json({
      items,
      count: items.length
    });
  })
);

const ingestOsmSchema = z.object({
  osmId: z.string().min(3),
  name: z.string().min(2),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  hasDiesel: z.boolean().optional(),
  city: z.string().optional()
});

router.post(
  "/ingest-osm",
  requireAuth(["station_manager", "admin"]),
  asyncHandler(async (req, res) => {
    const payload = ingestOsmSchema.parse(req.body);

    let station = (await StationModel.findOne({ osmId: payload.osmId }).lean()) as any;

    if (!station) {
      const nearby = await StationModel.aggregate<any>([
        {
          $geoNear: {
            near: { type: "Point", coordinates: [payload.lng, payload.lat] },
            distanceField: "distanceMeters",
            spherical: true,
            maxDistance: 120,
            query: { isActive: true }
          }
        },
        { $limit: 1 }
      ]);

      if (nearby[0]) {
        await StationModel.updateOne(
          { _id: nearby[0]._id },
          {
            $set: {
              osmId: payload.osmId,
              name: nearby[0].name || payload.name,
              city: nearby[0].city || payload.city || inferCityFromCoordinates(payload.lat, payload.lng),
              supportsDiesel: payload.hasDiesel === true ? true : Boolean(nearby[0].supportsDiesel)
            }
          }
        );
        station = (await StationModel.findById(nearby[0]._id).lean()) as any;
      } else {
        const created = await StationModel.create({
          osmId: payload.osmId,
          name: payload.name,
          city: payload.city ?? inferCityFromCoordinates(payload.lat, payload.lng),
          location: {
            type: "Point",
            coordinates: [payload.lng, payload.lat]
          },
          supportsGasoline: true,
          supportsDiesel: payload.hasDiesel ?? false,
          isActive: true,
          currentFuelStatus: "low",
          currentDieselStatus: payload.hasDiesel ? "low" : "unavailable",
          currentCongestion: "none",
          currentConfidence: 0.5,
          lastVerifiedAt: null
        });
        station = created.toObject();
      }
    } else if (payload.hasDiesel === true && !station.supportsDiesel) {
      await StationModel.updateOne(
        { _id: station._id },
        {
          $set: {
            supportsDiesel: true,
            currentDieselStatus: station.currentDieselStatus === "unavailable" ? "low" : station.currentDieselStatus
          }
        }
      );
      station = (await StationModel.findById(station._id).lean()) as any;
    }

    res.json(stationToDto(station));
  })
);

const fuelTypesSchema = z
  .object({
    fuelStatus: z.enum(["available", "low", "unavailable", "closed"]).optional(),
    supportsDiesel: z.boolean().optional(),
    supportsGasoline: z.boolean().optional(),
    dieselStatus: z.enum(["available", "low", "unavailable"]).optional(),
    congestion: z.enum(["none", "medium", "high"]).optional()
  })
  .refine(
    (value) =>
      value.fuelStatus !== undefined ||
      value.supportsDiesel !== undefined ||
      value.supportsGasoline !== undefined ||
      value.dieselStatus !== undefined ||
      value.congestion !== undefined,
    {
    message: "At least one field is required"
    }
  );

router.patch(
  "/:id/fuel-types",
  requireAuth(["station_manager", "admin"]),
  asyncHandler(async (req, res) => {
    const stationId = z.string().min(8).parse(req.params.id);
    const body = fuelTypesSchema.parse(req.body);

    const station = (await StationModel.findById(stationId).lean()) as any;
    if (!station) {
      throw new HttpError(404, "Station not found");
    }

    const shouldRefreshVerification =
      body.fuelStatus !== undefined || body.dieselStatus !== undefined || body.congestion !== undefined;

    await StationModel.updateOne(
      { _id: stationId },
      {
        $set: {
          ...(body.fuelStatus !== undefined ? { currentFuelStatus: body.fuelStatus } : {}),
          ...(body.supportsDiesel !== undefined ? { supportsDiesel: body.supportsDiesel } : {}),
          ...(body.supportsGasoline !== undefined ? { supportsGasoline: body.supportsGasoline } : {}),
          ...(body.dieselStatus !== undefined ? { currentDieselStatus: body.dieselStatus } : {}),
          ...(body.congestion !== undefined ? { currentCongestion: body.congestion } : {}),
          ...(shouldRefreshVerification
            ? {
                currentConfidence: 0.9,
                lastVerifiedAt: new Date()
              }
            : {})
        }
      }
    );

    const updated = (await StationModel.findById(stationId).lean()) as any;
    realtimeBroker.publishStationUpdated({
      stationId,
      fuelStatus: updated.currentFuelStatus,
      dieselStatus: updated.currentDieselStatus ?? "unavailable",
      congestion: updated.currentCongestion,
      confidence: updated.currentConfidence ?? 0,
      at: new Date().toISOString()
    });
    res.json(stationToDto(updated));
  })
);

router.get(
  "/distance/check",
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        stationId: z.string().min(8),
        lat: z.coerce.number(),
        lng: z.coerce.number()
      })
      .parse(req.query);

    const station = (await StationModel.findById(query.stationId).lean()) as any;
    if (!station) {
      throw new HttpError(404, "Station not found");
    }

    const distance = haversineMeters(
      query.lat,
      query.lng,
      station.location.coordinates[1],
      station.location.coordinates[0]
    );

    res.json({ stationId: query.stationId, distanceMeters: Math.round(distance) });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const stationId = z.string().min(8).parse(req.params.id);

    const [station, history, prediction] = await Promise.all([
      StationModel.findById(stationId).lean() as Promise<any>,
      StationStatusHistoryModel.find({ stationId }).sort({ snapshotAt: -1 }).limit(20).lean() as Promise<any[]>,
      ModelPredictionModel.findOne({ stationId }).sort({ predictedAt: -1 }).lean() as Promise<any>
    ]);

    if (!station) {
      throw new HttpError(404, "Station not found");
    }

    res.json({
      ...stationToDto(station),
      openingHours: station.openingHours ?? null,
      history: history.map((entry) => ({
        fuelStatus: entry.fuelStatus,
        dieselStatus: entry.dieselStatus ?? "unavailable",
        congestion: entry.congestion,
        confidence: entry.confidence,
        snapshotAt: entry.snapshotAt
      })),
      prediction: prediction
        ? {
            modelName: prediction.modelName,
            modelVersion: prediction.modelVersion,
            predictWindowMinutes: prediction.predictWindowMinutes,
            fuelUnavailableProb: prediction.fuelUnavailableProb,
            highCongestionProb: prediction.highCongestionProb,
            etaRecoveryMinutes: prediction.etaRecoveryMinutes ?? null,
            predictedAt: prediction.predictedAt,
            validUntil: prediction.validUntil
          }
        : null
    });
  })
);

const officialUpdateSchema = z.object({
  fuelStatus: z.enum(["available", "low", "unavailable", "closed"]),
  congestion: z.enum(["none", "medium", "high"]),
  note: z.string().max(300).optional()
});

router.post(
  "/:id/official-update",
  requireAuth(["station_manager", "admin"]),
  asyncHandler(async (req, res) => {
    const stationId = z.string().min(8).parse(req.params.id);
    const body = officialUpdateSchema.parse(req.body);
    const actor = req.user;
    if (!actor) {
      throw new HttpError(401, "Unauthorized");
    }

    const station = (await StationModel.findById(stationId).lean()) as any;
    if (!station) {
      throw new HttpError(404, "Station not found");
    }

    const officialUpdate = await StationOfficialUpdateModel.create({
      stationId,
      managerUserId: actor.id,
      fuelStatus: body.fuelStatus,
      congestion: body.congestion,
      note: body.note ?? null
    });

    await StationModel.updateOne(
      { _id: stationId },
      {
        $set: {
          currentFuelStatus: body.fuelStatus,
          currentCongestion: body.congestion,
          currentConfidence: 0.95,
          lastVerifiedAt: new Date()
        }
      }
    );

    await StationStatusHistoryModel.create({
      stationId,
      fuelStatus: body.fuelStatus,
      dieselStatus: station.currentDieselStatus ?? "unavailable",
      congestion: body.congestion,
      confidence: 0.95,
      computedFromReports: 1,
      source: "official",
      snapshotAt: new Date()
    });

    realtimeBroker.publishStationUpdated({
      stationId,
      fuelStatus: body.fuelStatus,
      dieselStatus: station.currentDieselStatus ?? "unavailable",
      congestion: body.congestion,
      confidence: 0.95,
      at: new Date().toISOString()
    });

    res.status(201).json({
      officialUpdateId: officialUpdate._id,
      applied: true
    });
  })
);

export const stationsRouter = router;

function inferCityFromCoordinates(lat: number, lng: number): string {
  if (lat > 31 && lat < 33.5 && lng > 19 && lng < 21.5) {
    return "Benghazi";
  }
  if (lat > 32 && lat < 33.5 && lng > 12 && lng < 14.5) {
    return "Tripoli";
  }
  return "Libya";
}
