import { TrustScoreModel } from "../../db/models.js";

export async function getUserTrustScore(userId: string): Promise<number> {
  const trust = (await TrustScoreModel.findOne({ userId }).lean()) as any;
  return trust?.score ?? 50;
}

interface TrustOutcomeItem {
  userId: string;
  reportFuelStatus: string;
  reportCongestion: string;
}

export async function applyTrustOutcome(
  outcomes: TrustOutcomeItem[],
  finalFuelStatus: string,
  finalCongestion: string
): Promise<void> {
  if (outcomes.length === 0) {
    return;
  }

  for (const item of outcomes) {
    const fuelMatch = item.reportFuelStatus === finalFuelStatus;
    const congestionMatch = item.reportCongestion === finalCongestion;
    const delta = fuelMatch && congestionMatch ? 1.2 : fuelMatch || congestionMatch ? 0.4 : -1.5;

    const existing = (await TrustScoreModel.findOne({ userId: item.userId }).lean()) as any;
    if (!existing) {
      const score = Math.max(0, Math.min(100, 50 + delta));
      await TrustScoreModel.create({
        userId: item.userId,
        score,
        totalReports: 1,
        acceptedReports: delta >= 0 ? 1 : 0,
        rejectedReports: delta < 0 ? 1 : 0
      });
      continue;
    }

    await TrustScoreModel.updateOne(
      { userId: item.userId },
      {
        $set: {
          score: Math.max(0, Math.min(100, existing.score + delta))
        },
        $inc: {
          totalReports: 1,
          acceptedReports: delta >= 0 ? 1 : 0,
          rejectedReports: delta < 0 ? 1 : 0
        }
      }
    );
  }
}
