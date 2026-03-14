import { randomUUID } from "node:crypto";
import mongoose, { Schema } from "mongoose";

export type FuelStatus = "available" | "low" | "unavailable" | "closed";
export type DieselStatus = "available" | "low" | "unavailable";
export type Congestion = "none" | "medium" | "high";
export type AppRole = "user" | "station_manager" | "admin";

const pointSchema = new Schema(
  {
    type: { type: String, enum: ["Point"], required: true, default: "Point" },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (v: number[]) => v.length === 2,
        message: "Point coordinates must be [lng, lat]"
      }
    }
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    _id: { type: String, default: () => randomUUID() },
    phoneE164: { type: String, unique: true, sparse: true },
    fullName: { type: String, required: true },
    address: { type: String },
    passwordHash: { type: String },
    role: { type: String, enum: ["user", "station_manager", "admin"], default: "user" },
    city: { type: String },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

const trustScoreSchema = new Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    score: { type: Number, default: 50 },
    totalReports: { type: Number, default: 0 },
    acceptedReports: { type: Number, default: 0 },
    rejectedReports: { type: Number, default: 0 },
    lastRecomputedAt: { type: Date }
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

const stationSchema = new Schema(
  {
    _id: { type: String, default: () => randomUUID() },
    osmId: { type: String, unique: true, sparse: true, index: true },
    name: { type: String, required: true },
    city: { type: String, required: true, index: true },
    address: { type: String },
    location: { type: pointSchema, required: true },
    supportsGasoline: { type: Boolean, default: true },
    supportsDiesel: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true, index: true },
    openingHours: { type: Schema.Types.Mixed },
    currentFuelStatus: {
      type: String,
      enum: ["available", "low", "unavailable", "closed"],
      default: "unavailable"
    },
    currentDieselStatus: {
      type: String,
      enum: ["available", "low", "unavailable"],
      default: "unavailable"
    },
    currentCongestion: { type: String, enum: ["none", "medium", "high"], default: "none" },
    currentConfidence: { type: Number, default: 0 },
    lastVerifiedAt: { type: Date }
  },
  { timestamps: true }
);

stationSchema.index({ location: "2dsphere" });

const crowdReportSchema = new Schema(
  {
    _id: { type: String, default: () => randomUUID() },
    userId: { type: String, required: true, index: true },
    stationId: { type: String, required: true, index: true },
    stationCity: { type: String, index: true },
    fuelStatus: { type: String, enum: ["available", "low", "unavailable", "closed"], required: true },
    dieselStatus: { type: String, enum: ["available", "low", "unavailable"] },
    congestion: { type: String, enum: ["none", "medium", "high"], required: true },
    reportLocation: { type: pointSchema, required: true },
    distanceToStationM: { type: Number },
    imageUrl: { type: String },
    imageFeatures: { type: Schema.Types.Mixed },
    source: { type: String, enum: ["crowd", "official", "system"], default: "crowd" },
    trustWeightUsed: { type: Number },
    verificationState: {
      type: String,
      enum: ["pending", "accepted", "rejected", "flagged"],
      default: "pending",
      index: true
    },
    verificationReason: { type: String }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

crowdReportSchema.index({ reportLocation: "2dsphere" });
crowdReportSchema.index({ stationId: 1, createdAt: -1 });

const stationOfficialUpdateSchema = new Schema(
  {
    _id: { type: String, default: () => randomUUID() },
    stationId: { type: String, required: true, index: true },
    managerUserId: { type: String, required: true },
    fuelStatus: { type: String, enum: ["available", "low", "unavailable", "closed"], required: true },
    dieselStatus: { type: String, enum: ["available", "low", "unavailable"] },
    congestion: { type: String, enum: ["none", "medium", "high"], required: true },
    note: { type: String }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const stationStatusHistorySchema = new Schema(
  {
    _id: { type: String, default: () => randomUUID() },
    stationId: { type: String, required: true, index: true },
    fuelStatus: { type: String, enum: ["available", "low", "unavailable", "closed"], required: true },
    dieselStatus: { type: String, enum: ["available", "low", "unavailable"] },
    congestion: { type: String, enum: ["none", "medium", "high"], required: true },
    confidence: { type: Number, required: true },
    computedFromReports: { type: Number, default: 0 },
    source: { type: String, enum: ["crowd", "official", "system"], default: "system" },
    snapshotAt: { type: Date, default: Date.now, index: true }
  },
  { timestamps: false }
);

const notificationPreferenceSchema = new Schema(
  {
    _id: { type: String, default: () => randomUUID() },
    userId: { type: String, required: true, unique: true, index: true },
    city: { type: String },
    maxRadiusKm: { type: Number, default: 10 },
    notifyGasoline: { type: Boolean, default: true },
    notifyDiesel: { type: Boolean, default: true },
    notifyHighCongestion: { type: Boolean, default: true },
    pushEnabled: { type: Boolean, default: true }
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

const notificationSchema = new Schema(
  {
    _id: { type: String, default: () => randomUUID() },
    userId: { type: String, required: true, index: true },
    stationId: { type: String },
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    payload: { type: Schema.Types.Mixed },
    sentAt: { type: Date },
    deliveredAt: { type: Date },
    readAt: { type: Date }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const fraudFlagSchema = new Schema(
  {
    _id: { type: String, default: () => randomUUID() },
    reportId: { type: String, index: true },
    userId: { type: String, index: true },
    stationId: { type: String, index: true },
    flagType: { type: String, required: true },
    score: { type: Number, required: true },
    details: { type: Schema.Types.Mixed },
    resolvedAt: { type: Date }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const modelPredictionSchema = new Schema(
  {
    _id: { type: String, default: () => randomUUID() },
    stationId: { type: String, required: true, index: true },
    modelName: { type: String, required: true },
    modelVersion: { type: String, required: true },
    predictWindowMinutes: { type: Number, required: true },
    fuelUnavailableProb: { type: Number, required: true },
    highCongestionProb: { type: Number, required: true },
    etaRecoveryMinutes: { type: Number },
    featuresHash: { type: String },
    predictedAt: { type: Date, default: Date.now, index: true },
    validUntil: { type: Date, required: true, index: true }
  },
  { timestamps: false }
);

const supportThreadSchema = new Schema(
  {
    _id: { type: String, default: () => randomUUID() },
    userId: { type: String, required: true, index: true },
    userFullName: { type: String, required: true },
    userPhoneE164: { type: String },
    subject: { type: String, maxlength: 120 },
    status: { type: String, enum: ["open", "closed"], default: "open", index: true },
    unreadForAdmin: { type: Number, default: 0, min: 0 },
    unreadForUser: { type: Number, default: 0, min: 0 },
    lastMessageAt: { type: Date, index: true },
    lastMessagePreview: { type: String, maxlength: 300 }
  },
  { timestamps: true }
);

supportThreadSchema.index({ userId: 1, status: 1, updatedAt: -1 });
supportThreadSchema.index({ unreadForAdmin: 1, updatedAt: -1 });

const supportMessageSchema = new Schema(
  {
    _id: { type: String, default: () => randomUUID() },
    threadId: { type: String, required: true, index: true },
    senderId: { type: String, required: true, index: true },
    senderRole: { type: String, enum: ["user", "station_manager", "admin"], required: true },
    body: { type: String, required: true, maxlength: 2000 },
    readByAdmin: { type: Boolean, default: false, index: true },
    readByUser: { type: Boolean, default: false, index: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

supportMessageSchema.index({ threadId: 1, createdAt: 1 });

export const UserModel = mongoose.models.User || mongoose.model("User", userSchema);
export const TrustScoreModel = mongoose.models.TrustScore || mongoose.model("TrustScore", trustScoreSchema);
export const StationModel = mongoose.models.Station || mongoose.model("Station", stationSchema);
export const CrowdReportModel = mongoose.models.CrowdReport || mongoose.model("CrowdReport", crowdReportSchema);
export const StationOfficialUpdateModel =
  mongoose.models.StationOfficialUpdate || mongoose.model("StationOfficialUpdate", stationOfficialUpdateSchema);
export const StationStatusHistoryModel =
  mongoose.models.StationStatusHistory || mongoose.model("StationStatusHistory", stationStatusHistorySchema);
export const NotificationPreferenceModel =
  mongoose.models.NotificationPreference || mongoose.model("NotificationPreference", notificationPreferenceSchema);
export const NotificationModel = mongoose.models.Notification || mongoose.model("Notification", notificationSchema);
export const FraudFlagModel = mongoose.models.FraudFlag || mongoose.model("FraudFlag", fraudFlagSchema);
export const ModelPredictionModel =
  mongoose.models.ModelPrediction || mongoose.model("ModelPrediction", modelPredictionSchema);
export const SupportThreadModel = mongoose.models.SupportThread || mongoose.model("SupportThread", supportThreadSchema);
export const SupportMessageModel =
  mongoose.models.SupportMessage || mongoose.model("SupportMessage", supportMessageSchema);
