import { CrowdReportModel, FraudFlagModel } from "../../db/models.js";

export async function getFraudPenalty(userId: string, stationId: string): Promise<number> {
  const count = await FraudFlagModel.countDocuments({
    userId,
    stationId,
    createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    resolvedAt: { $exists: false }
  });

  if (count === 0) return 1.0;
  if (count <= 2) return 0.8;
  if (count <= 5) return 0.5;
  return 0.2;
}

export async function flagFraud(args: {
  reportId?: string;
  userId?: string;
  stationId?: string;
  flagType: string;
  score: number;
  details?: Record<string, unknown>;
}): Promise<void> {
  await FraudFlagModel.create({
    reportId: args.reportId,
    userId: args.userId,
    stationId: args.stationId,
    flagType: args.flagType,
    score: args.score,
    details: args.details ?? {}
  });
}

export async function checkBurstReporting(userId: string, stationId: string): Promise<boolean> {
  const count = await CrowdReportModel.countDocuments({
    userId,
    stationId,
    createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) }
  });
  return count >= 8;
}
