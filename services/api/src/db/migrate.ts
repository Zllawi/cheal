import mongoose from "mongoose";
import { connectMongoSafely } from "./pool.js";
import {
  CrowdReportModel,
  FraudFlagModel,
  ModelPredictionModel,
  NotificationPreferenceModel,
  StationModel,
  StationStatusHistoryModel,
  TrustScoreModel,
  UserModel
} from "./models.js";

async function run(): Promise<void> {
  await connectMongoSafely();

  await Promise.all([
    UserModel.syncIndexes(),
    TrustScoreModel.syncIndexes(),
    StationModel.syncIndexes(),
    CrowdReportModel.syncIndexes(),
    StationStatusHistoryModel.syncIndexes(),
    NotificationPreferenceModel.syncIndexes(),
    FraudFlagModel.syncIndexes(),
    ModelPredictionModel.syncIndexes()
  ]);

  console.log("Mongo indexes are synced.");
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error("Mongo migration failed", error);
  await mongoose.disconnect();
  process.exit(1);
});
