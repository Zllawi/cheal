import {
  CrowdReportModel,
  type Congestion,
  type DieselStatus,
  type FuelStatus,
  StationModel,
  StationStatusHistoryModel,
  TrustScoreModel
} from "../../db/models.js";
import { realtimeBroker } from "../realtime/broker.js";
import { getFraudPenalty } from "../fraud/service.js";
import { applyTrustOutcome } from "../trust/service.js";
import { haversineMeters } from "../../utils/geo.js";

interface VerificationResult {
  verifiedStatus: {
    fuel: FuelStatus;
    diesel: DieselStatus;
    congestion: Congestion;
  };
  confidenceScore: number;
  needsManualReview: boolean;
  usedReports: number;
}

const MAX_DISTANCE_METERS = 2000;
const MIN_CONFIDENCE_TO_APPLY = 0.62;
const MIN_TOTAL_WEIGHT = 0.35;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function expDecay(minutes: number, halfLifeMinutes = 30): number {
  return Math.exp(-minutes / halfLifeMinutes);
}

function pickWeightedTop<T extends string>(weights: Record<T, number>): T {
  let bestKey = Object.keys(weights)[0] as T;
  let bestValue = -Infinity;
  for (const [key, value] of Object.entries(weights) as Array<[T, number]>) {
    if (value > bestValue) {
      bestKey = key;
      bestValue = value;
    }
  }
  return bestKey;
}

export async function computeStationState(stationId: string): Promise<VerificationResult | null> {
  const station = (await StationModel.findById(stationId).lean()) as any;
  if (!station) {
    return null;
  }

  const reports = (await CrowdReportModel.find({
    stationId,
    createdAt: { $gte: new Date(Date.now() - 45 * 60 * 1000) },
    verificationState: { $in: ["pending", "accepted"] }
  })
    .sort({ createdAt: -1 })
    .lean()) as any[];

  if (reports.length === 0) {
    return null;
  }

  const userIds = [...new Set(reports.map((report) => report.userId))];
  const trustScores = (await TrustScoreModel.find({ userId: { $in: userIds } }).lean()) as any[];
  const trustMap = new Map(trustScores.map((entry) => [entry.userId, entry.score]));

  const fuelWeights: Record<FuelStatus, number> = {
    available: 0,
    low: 0,
    unavailable: 0,
    closed: 0
  };
  const congestionWeights: Record<Congestion, number> = {
    none: 0,
    medium: 0,
    high: 0
  };
  const dieselWeights: Record<DieselStatus, number> = {
    available: 0,
    low: 0,
    unavailable: 0
  };

  const usedReportIds: string[] = [];
  const trustOutcomes: Array<{ userId: string; reportFuelStatus: FuelStatus; reportCongestion: Congestion }> = [];

  let totalWeight = 0;
  let suspiciousCount = 0;

  for (const report of reports) {
    const fuel = report.fuelStatus as FuelStatus;
    const congestion = report.congestion as Congestion;
    const diesel = report.dieselStatus as DieselStatus | undefined;
    const reportLat = report.reportLocation.coordinates[1];
    const reportLng = report.reportLocation.coordinates[0];
    const stationLat = station.location.coordinates[1];
    const stationLng = station.location.coordinates[0];
    const distanceMeters = report.distanceToStationM ?? haversineMeters(reportLat, reportLng, stationLat, stationLng);

    if (distanceMeters > MAX_DISTANCE_METERS) {
      suspiciousCount += 1;
      await CrowdReportModel.updateOne(
        { _id: report._id },
        {
          $set: {
            verificationState: "rejected",
            verificationReason: "distance_violation"
          }
        }
      );
      continue;
    }

    const ageMinutes = (Date.now() - new Date(report.createdAt).getTime()) / 60000;
    const trustScore = trustMap.get(report.userId) ?? 50;
    const trustWeight = clamp(trustScore / 100, 0.1, 1);
    const distanceWeight = clamp(1 - distanceMeters / MAX_DISTANCE_METERS, 0.05, 1);
    const recencyWeight = expDecay(ageMinutes);
    const fraudPenalty = await getFraudPenalty(report.userId, stationId);

    const weight = trustWeight * distanceWeight * recencyWeight * fraudPenalty;
    if (weight <= 0) {
      suspiciousCount += 1;
      continue;
    }

    fuelWeights[fuel] += weight;
    congestionWeights[congestion] += weight;
    if (diesel) {
      dieselWeights[diesel] += weight;
    }
    totalWeight += weight;
    usedReportIds.push(report._id);
    trustOutcomes.push({
      userId: report.userId,
      reportFuelStatus: fuel,
      reportCongestion: congestion
    });
  }

  if (totalWeight < MIN_TOTAL_WEIGHT || usedReportIds.length === 0) {
    return null;
  }

  const finalFuel = pickWeightedTop(fuelWeights);
  const finalCongestion = pickWeightedTop(congestionWeights);
  const hasDieselEvidence = Object.values(dieselWeights).some((value) => value > 0);
  const finalDiesel: DieselStatus = hasDieselEvidence
    ? pickWeightedTop(dieselWeights)
    : (station.currentDieselStatus as DieselStatus | undefined) ?? "unavailable";
  const consensus =
    (Math.max(...Object.values(fuelWeights)) + Math.max(...Object.values(congestionWeights))) /
    (2 * totalWeight);
  const volumeFactor = clamp(usedReportIds.length / 6, 0, 1);
  const confidence = clamp(0.7 * consensus + 0.3 * volumeFactor, 0, 1);
  const needsManualReview = confidence < MIN_CONFIDENCE_TO_APPLY || suspiciousCount >= 3;

  if (!needsManualReview) {
    await StationModel.updateOne(
      { _id: stationId },
      {
        $set: {
          currentFuelStatus: finalFuel,
          currentDieselStatus: finalDiesel,
          ...(finalDiesel !== "unavailable" ? { supportsDiesel: true } : {}),
          currentCongestion: finalCongestion,
          currentConfidence: confidence,
          lastVerifiedAt: new Date()
        }
      }
    );

    await StationStatusHistoryModel.create({
      stationId,
      fuelStatus: finalFuel,
      dieselStatus: finalDiesel,
      congestion: finalCongestion,
      confidence,
      computedFromReports: usedReportIds.length,
      source: "system",
      snapshotAt: new Date()
    });

    await CrowdReportModel.updateMany(
      { _id: { $in: usedReportIds } },
      {
        $set: {
          verificationState: "accepted",
          verificationReason: null
        }
      }
    );
  } else {
    await CrowdReportModel.updateMany(
      { _id: { $in: usedReportIds } },
      {
        $set: {
          verificationState: "flagged",
          verificationReason: "low_confidence"
        }
      }
    );
  }

  await applyTrustOutcome(trustOutcomes, finalFuel, finalCongestion);

  if (!needsManualReview) {
    realtimeBroker.publishStationUpdated({
      stationId,
      fuelStatus: finalFuel,
      dieselStatus: finalDiesel,
      congestion: finalCongestion,
      confidence,
      at: new Date().toISOString()
    });
  }

  return {
    verifiedStatus: { fuel: finalFuel, diesel: finalDiesel, congestion: finalCongestion },
    confidenceScore: confidence,
    needsManualReview,
    usedReports: usedReportIds.length
  };
}
