import { Router } from "express";
import { requireAuth } from "../auth/jwt.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { CrowdReportModel, FraudFlagModel } from "../../db/models.js";

const router = Router();

router.get(
  "/overview",
  requireAuth(["admin"]),
  asyncHandler(async (_req, res) => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [topCongestedStations, demandByCity, hourlyPeaks, fraudTrend] = await Promise.all([
      CrowdReportModel.aggregate([
        {
          $match: {
            congestion: "high",
            createdAt: { $gte: sevenDaysAgo }
          }
        },
        {
          $group: {
            _id: "$stationId",
            highCongestionReports: { $sum: 1 },
            city: { $first: "$stationCity" }
          }
        },
        { $sort: { highCongestionReports: -1 } },
        { $limit: 10 },
        {
          $project: {
            _id: 0,
            stationId: "$_id",
            city: { $ifNull: ["$city", "Unknown"] },
            highCongestionReports: 1
          }
        }
      ]),
      CrowdReportModel.aggregate([
        {
          $match: {
            createdAt: { $gte: sevenDaysAgo }
          }
        },
        {
          $group: {
            _id: "$stationCity",
            reportsCount: { $sum: 1 }
          }
        },
        { $sort: { reportsCount: -1 } },
        {
          $project: {
            _id: 0,
            city: { $ifNull: ["$_id", "Unknown"] },
            reportsCount: 1
          }
        }
      ]),
      CrowdReportModel.aggregate([
        { $match: { createdAt: { $gte: fourteenDaysAgo } } },
        { $group: { _id: { $hour: "$createdAt" }, reportsCount: { $sum: 1 } } },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, hour: "$_id", reportsCount: 1 } }
      ]),
      FraudFlagModel.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
            },
            flagsCount: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, day: "$_id", flagsCount: 1 } }
      ])
    ]);

    res.json({
      topCongestedStations,
      demandByCity,
      hourlyPeaks,
      fraudTrend
    });
  })
);

export const analyticsRouter = router;
