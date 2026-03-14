import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/async-handler.js";
import { env } from "../../config/env.js";
import { ModelPredictionModel } from "../../db/models.js";

const router = Router();

async function requestAiPrediction(stationId: string): Promise<{
  modelName: string;
  modelVersion: string;
  predictWindowMinutes: number;
  fuelUnavailableProb: number;
  highCongestionProb: number;
  etaRecoveryMinutes: number | null;
}> {
  const response = await fetch(`${env.AI_SERVICE_URL}/predict/${stationId}`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(`AI service error ${response.status}`);
  }

  return (await response.json()) as {
    modelName: string;
    modelVersion: string;
    predictWindowMinutes: number;
    fuelUnavailableProb: number;
    highCongestionProb: number;
    etaRecoveryMinutes: number | null;
  };
}

router.get(
  "/:stationId",
  asyncHandler(async (req, res) => {
    const stationId = z.string().min(8).parse(req.params.stationId);

    let prediction = (await ModelPredictionModel.findOne({
      stationId,
      validUntil: { $gt: new Date() }
    })
      .sort({ predictedAt: -1 })
      .lean()) as any;

    if (!prediction) {
      try {
        const aiPrediction = await requestAiPrediction(stationId);
        const created = await ModelPredictionModel.create({
          stationId,
          modelName: aiPrediction.modelName,
          modelVersion: aiPrediction.modelVersion,
          predictWindowMinutes: aiPrediction.predictWindowMinutes,
          fuelUnavailableProb: aiPrediction.fuelUnavailableProb,
          highCongestionProb: aiPrediction.highCongestionProb,
          etaRecoveryMinutes: aiPrediction.etaRecoveryMinutes,
          predictedAt: new Date(),
          validUntil: new Date(Date.now() + 60 * 60 * 1000)
        });
        prediction = created.toObject();
      } catch {
        res.json({
          stationId,
          modelName: "fallback",
          modelVersion: "v0",
          predictWindowMinutes: 60,
          fuelUnavailableProb: 0.5,
          highCongestionProb: 0.5,
          etaRecoveryMinutes: null,
          predictedAt: new Date().toISOString(),
          validUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString()
        });
        return;
      }
    }

    res.json({
      stationId,
      modelName: prediction.modelName,
      modelVersion: prediction.modelVersion,
      predictWindowMinutes: prediction.predictWindowMinutes,
      fuelUnavailableProb: prediction.fuelUnavailableProb,
      highCongestionProb: prediction.highCongestionProb,
      etaRecoveryMinutes: prediction.etaRecoveryMinutes ?? null,
      predictedAt: prediction.predictedAt,
      validUntil: prediction.validUntil
    });
  })
);

export const predictionsRouter = router;
