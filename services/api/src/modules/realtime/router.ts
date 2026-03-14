import { Router } from "express";
import { realtimeBroker } from "./broker.js";

const router = Router();

router.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, ts: new Date().toISOString() })}\n\n`);

  const unsubscribe = realtimeBroker.onStationUpdated((payload) => {
    res.write(`event: station.updated\ndata: ${JSON.stringify(payload)}\n\n`);
  });

  const pingTimer = setInterval(() => {
    res.write(`event: ping\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);
  }, 20000);

  req.on("close", () => {
    clearInterval(pingTimer);
    unsubscribe();
  });
});

export const realtimeRouter = router;
