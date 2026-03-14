import mongoose from "mongoose";
import { connectMongoSafely } from "./pool.js";
import { StationModel, TrustScoreModel, UserModel } from "./models.js";
import { hashPassword } from "../modules/auth/password.js";

async function run(): Promise<void> {
  await connectMongoSafely();

  const defaultAdminPasswordHash = await hashPassword("Admin@12345");
  const defaultManagerPasswordHash = await hashPassword("Manager@12345");
  const defaultUserPasswordHash = await hashPassword("User@12345");

  const users = [
    {
      _id: "11111111-1111-1111-1111-111111111111",
      phoneE164: "+218910000001",
      fullName: "Admin User",
      address: "Tripoli",
      role: "admin",
      city: "Tripoli",
      passwordHash: defaultAdminPasswordHash
    },
    {
      _id: "22222222-2222-2222-2222-222222222222",
      phoneE164: "+218910000002",
      fullName: "Station Manager",
      address: "Tripoli",
      role: "station_manager",
      city: "Tripoli",
      passwordHash: defaultManagerPasswordHash
    },
    {
      _id: "33333333-3333-3333-3333-333333333333",
      phoneE164: "+218910000003",
      fullName: "Regular User",
      address: "Tripoli",
      role: "user",
      city: "Tripoli",
      passwordHash: defaultUserPasswordHash
    }
  ] as const;

  for (const user of users) {
    const { _id, ...userData } = user;
    await UserModel.updateOne(
      { _id },
      {
        $setOnInsert: { _id },
        $set: userData
      },
      { upsert: true }
    );
  }

  const trustScores = [
    { userId: "11111111-1111-1111-1111-111111111111", score: 90, totalReports: 12, acceptedReports: 11, rejectedReports: 1 },
    { userId: "22222222-2222-2222-2222-222222222222", score: 85, totalReports: 10, acceptedReports: 8, rejectedReports: 2 },
    { userId: "33333333-3333-3333-3333-333333333333", score: 60, totalReports: 5, acceptedReports: 3, rejectedReports: 2 }
  ] as const;

  for (const trust of trustScores) {
    await TrustScoreModel.updateOne({ userId: trust.userId }, { $setOnInsert: trust }, { upsert: true });
  }

  const stations = [
    {
      _id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      name: "محطة النصر",
      city: "Tripoli",
      address: "شارع الجمهورية",
      location: { type: "Point", coordinates: [13.1802, 32.8923] as [number, number] },
      supportsGasoline: true,
      supportsDiesel: true,
      currentFuelStatus: "low",
      currentDieselStatus: "available",
      currentCongestion: "medium",
      currentConfidence: 0.72
    },
    {
      _id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      name: "محطة طريق المطار",
      city: "Tripoli",
      address: "طريق المطار",
      location: { type: "Point", coordinates: [13.1444, 32.8659] as [number, number] },
      supportsGasoline: true,
      supportsDiesel: true,
      currentFuelStatus: "available",
      currentDieselStatus: "low",
      currentCongestion: "none",
      currentConfidence: 0.81
    },
    {
      _id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      name: "محطة بنغازي المركز",
      city: "Benghazi",
      address: "وسط المدينة",
      location: { type: "Point", coordinates: [20.0675, 32.1167] as [number, number] },
      supportsGasoline: true,
      supportsDiesel: true,
      currentFuelStatus: "unavailable",
      currentDieselStatus: "unavailable",
      currentCongestion: "high",
      currentConfidence: 0.66
    }
  ] as const;

  for (const station of stations) {
    await StationModel.updateOne({ _id: station._id }, { $setOnInsert: station }, { upsert: true });
  }

  console.log("Mongo seeding completed.");
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error("Mongo seed failed", error);
  await mongoose.disconnect();
  process.exit(1);
});
