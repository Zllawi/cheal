# FuelMap Libya - Output Contract (Applied)

## 1) Architecture Diagram (Textual)

```text
[Web Client - Next.js (RTL Arabic)]
  |  HTTPS + JWT
  v
[API Gateway / BFF - Node.js + Express]
  |-- Auth Module (JWT, RBAC)
  |-- Stations Module
  |-- Reports Module
  |-- Notifications Module
  |-- Analytics Module
  |
  |  SQL (PostgreSQL + PostGIS)
  v
[Operational DB]
  |-- users
  |-- stations
  |-- crowd_reports
  |-- station_status_history
  |-- trust_scores
  |-- station_official_updates
  |-- notification_preferences
  |-- notifications
  |-- fraud_flags
  |-- model_predictions
  |
  +--> [Redis]
        |-- rate limits
        |-- hot cache (nearby stations)
        |-- BullMQ queues
                |-- verification jobs
                |-- trust re-score jobs
                |-- notifications jobs
                |-- model inference jobs
                v
          [Python AI Service - FastAPI]
            |-- verification helpers
            |-- congestion/fuel forecasting
            |-- anomaly detection
            |-- image analysis (OpenCV + YOLO)
            v
          [Model Store + Feature Store]

[Realtime Layer - WebSocket/SSE]
  ^ push station status updates
  |
[API/BFF]

[Observability]
  |-- structured logs
  |-- metrics (latency, confidence, fraud rate)
  |-- tracing + alerts
```

### Runtime Flow (Core)
- User sends report -> `POST /reports`.
- API validates payload, location distance, rate limits.
- Report stored as `pending`.
- Queue runs verification job -> computes weighted station state.
- If confidence >= threshold, station current state is updated.
- Realtime event pushes update to nearby clients.
- Notification worker sends targeted alerts by preferences.

## 2) Database Schema (Draft SQL)

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fuel_status_enum') THEN
    CREATE TYPE fuel_status_enum AS ENUM ('available', 'low', 'unavailable', 'closed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'congestion_enum') THEN
    CREATE TYPE congestion_enum AS ENUM ('none', 'medium', 'high');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'report_source_enum') THEN
    CREATE TYPE report_source_enum AS ENUM ('crowd', 'official', 'system');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 VARCHAR(20) UNIQUE,
  full_name VARCHAR(120),
  role VARCHAR(20) NOT NULL DEFAULT 'user', -- user/admin/station_manager
  city VARCHAR(80),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trust_scores (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  score NUMERIC(5,2) NOT NULL DEFAULT 50.00, -- 0..100
  total_reports INT NOT NULL DEFAULT 0,
  accepted_reports INT NOT NULL DEFAULT 0,
  rejected_reports INT NOT NULL DEFAULT 0,
  last_recomputed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(160) NOT NULL,
  city VARCHAR(80) NOT NULL,
  address TEXT,
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  supports_gasoline BOOLEAN NOT NULL DEFAULT TRUE,
  supports_diesel BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  opening_hours JSONB,
  current_fuel_status fuel_status_enum NOT NULL DEFAULT 'unavailable',
  current_congestion congestion_enum NOT NULL DEFAULT 'none',
  current_confidence NUMERIC(4,3) NOT NULL DEFAULT 0.000, -- 0..1
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stations_location_gist
  ON stations USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_stations_city ON stations(city);

CREATE TABLE IF NOT EXISTS crowd_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  fuel_status fuel_status_enum NOT NULL,
  congestion congestion_enum NOT NULL,
  report_location GEOGRAPHY(POINT, 4326) NOT NULL,
  distance_to_station_m NUMERIC(10,2),
  image_url TEXT,
  image_features JSONB,
  source report_source_enum NOT NULL DEFAULT 'crowd',
  trust_weight_used NUMERIC(5,4),
  verification_state VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending/accepted/rejected/flagged
  verification_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_station_time
  ON crowd_reports(station_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_user_time
  ON crowd_reports(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_location_gist
  ON crowd_reports USING GIST(report_location);

CREATE TABLE IF NOT EXISTS station_official_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  manager_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fuel_status fuel_status_enum NOT NULL,
  congestion congestion_enum NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_official_station_time
  ON station_official_updates(station_id, created_at DESC);

CREATE TABLE IF NOT EXISTS station_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  fuel_status fuel_status_enum NOT NULL,
  congestion congestion_enum NOT NULL,
  confidence NUMERIC(4,3) NOT NULL,
  computed_from_reports INT NOT NULL DEFAULT 0,
  source report_source_enum NOT NULL DEFAULT 'system',
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_station_history_station_time
  ON station_status_history(station_id, snapshot_at DESC);

CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  city VARCHAR(80),
  max_radius_km INT NOT NULL DEFAULT 10,
  notify_gasoline BOOLEAN NOT NULL DEFAULT TRUE,
  notify_diesel BOOLEAN NOT NULL DEFAULT TRUE,
  notify_high_congestion BOOLEAN NOT NULL DEFAULT TRUE,
  push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  station_id UUID REFERENCES stations(id) ON DELETE SET NULL,
  type VARCHAR(40) NOT NULL, -- fuel_available / congestion_alert / shipment_arrived
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  payload JSONB,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_time
  ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS fraud_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID REFERENCES crowd_reports(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  station_id UUID REFERENCES stations(id) ON DELETE SET NULL,
  flag_type VARCHAR(60) NOT NULL, -- distance_violation / burst_reporting / collusion_pattern
  score NUMERIC(5,4) NOT NULL, -- 0..1
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_fraud_user_time
  ON fraud_flags(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_station_time
  ON fraud_flags(station_id, created_at DESC);

CREATE TABLE IF NOT EXISTS model_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  model_name VARCHAR(80) NOT NULL,
  model_version VARCHAR(40) NOT NULL,
  predict_window_minutes INT NOT NULL, -- e.g. 60, 180
  fuel_unavailable_prob NUMERIC(5,4) NOT NULL,
  high_congestion_prob NUMERIC(5,4) NOT NULL,
  eta_recovery_minutes INT,
  features_hash VARCHAR(128),
  predicted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_predictions_station_time
  ON model_predictions(station_id, predicted_at DESC);

-- Retention (example policy)
-- crowd_reports: keep raw reports 180 days, archive afterward
-- notifications: keep 90 days
-- station_status_history: keep 365 days
```

## 3) API Spec

### `POST /reports`
- Auth: `user`, `station_manager`, `admin`
- Purpose: submit crowd report.

| Field | Type | Required | Validation |
|---|---|---|---|
| stationId | UUID | yes | exists + active station |
| fuelStatus | enum | yes | available/low/unavailable/closed |
| congestion | enum | yes | none/medium/high |
| lat | number | yes | -90..90 |
| lng | number | yes | -180..180 |
| imageUrl | string | no | valid URL |

Success `201`:
```json
{
  "reportId": "uuid",
  "verificationState": "pending",
  "queued": true
}
```

Errors:
- `400` invalid schema.
- `401` unauthorized.
- `403` role not allowed.
- `409` duplicate report in short interval.
- `422` distance too far from station.
- `429` rate limit exceeded.

### `GET /stations`
- Auth: public (optional token for personalization)
- Query: `city`, `fuelType`, `status`, `bbox`, `limit`, `cursor`.
- Returns station list with current verified state + confidence.

### `GET /stations/:id`
- Auth: public.
- Returns station profile, last verified state, recent history, latest prediction.

### `GET /stations/nearby`
- Auth: public or logged in.
- Query:
  - `lat` (required)
  - `lng` (required)
  - `radiusKm` (default 10, max 50)
  - `fuelType` (gasoline/diesel)
- Behavior: uses PostGIS distance ordering.

### `POST /stations/:id/official-update`
- Auth: `station_manager` (assigned station) or `admin`.
- Body:
  - `fuelStatus` enum
  - `congestion` enum
  - `note` optional
- Success:
```json
{
  "officialUpdateId": "uuid",
  "applied": true
}
```
- Errors: `403` not station manager, `404` station not found.

### `GET /predictions/:stationId`
- Auth: public.
- Response:
```json
{
  "stationId": "uuid",
  "modelVersion": "v1.3.0",
  "fuelUnavailableProb": 0.67,
  "highCongestionProb": 0.81,
  "etaRecoveryMinutes": 95,
  "predictedAt": "2026-03-06T08:15:00Z",
  "validUntil": "2026-03-06T09:15:00Z"
}
```

### `GET /analytics/overview`
- Auth: `admin`.
- Returns:
  - top congested stations
  - demand by city
  - hourly peaks
  - verification accuracy and fraud trend

### `POST /notifications/subscribe`
- Auth: `user`.
- Body:
  - `city`
  - `maxRadiusKm`
  - `notifyGasoline`
  - `notifyDiesel`
  - `notifyHighCongestion`
- Response: upserted preference object.

## 4) Core Verification Algorithm (Pseudo-code)

```text
function compute_station_state(station_id):
    now = current_time()
    window_minutes = 45
    max_distance_m = 2000
    min_confidence_to_apply = 0.62

    reports = fetch_reports(
        station_id=station_id,
        since=now - window_minutes,
        states=["pending", "accepted"]
    )

    if reports is empty:
        return keep_current_state(station_id, reason="no_recent_reports")

    weighted_fuel = map default 0
    weighted_congestion = map default 0
    total_weight = 0
    suspicious_count = 0

    for report in reports:
        trust = get_user_trust_score(report.user_id) / 100.0
        distance_m = geo_distance(report.report_location, station.location)
        if distance_m > max_distance_m:
            mark_report(report.id, "rejected", "distance_violation")
            suspicious_count += 1
            continue

        distance_weight = clamp(1 - (distance_m / max_distance_m), 0.05, 1.0)
        age_min = minutes_between(now, report.created_at)
        recency_weight = exp(-age_min / 30.0)
        image_weight = evaluate_image_consistency(report.image_features, report.fuel_status, report.congestion)
        anti_fraud_penalty = get_fraud_penalty(report.user_id, station_id)

        weight = trust * distance_weight * recency_weight * image_weight * anti_fraud_penalty
        if weight <= 0:
            suspicious_count += 1
            continue

        weighted_fuel[report.fuel_status] += weight
        weighted_congestion[report.congestion] += weight
        total_weight += weight

    if total_weight < 0.35:
        return keep_current_state(station_id, reason="insufficient_weight")

    fuel_status = argmax(weighted_fuel)
    congestion = argmax(weighted_congestion)

    consensus = (max(weighted_fuel.values) + max(weighted_congestion.values)) / (2 * total_weight)
    volume_factor = min(count(reports) / 6.0, 1.0)
    confidence = clamp(0.7 * consensus + 0.3 * volume_factor, 0, 1)

    needs_review = (confidence < min_confidence_to_apply) or (suspicious_count >= 3)

    if not needs_review:
        update_station_current_state(station_id, fuel_status, congestion, confidence, now)
        mark_reports_used(reports, "accepted")
        insert_status_history(station_id, fuel_status, congestion, confidence, len(reports))
    else:
        mark_reports_used(reports, "flagged_if_needed")

    recompute_user_trust_from_outcome(reports, fuel_status, congestion, confidence)

    return {
        "verified_status": {"fuel": fuel_status, "congestion": congestion},
        "confidence_score": confidence,
        "needs_manual_review": needs_review
    }
```

## 5) ML Pipeline (Training + Inference + Monitoring)

### Data Pipeline
- Extract:
  - `crowd_reports`, `station_status_history`, `official_updates`, calendar features.
- Transform:
  - aggregate by station and time buckets (15m/60m).
  - build lag features (last 1h, 3h, 24h).
  - trust-weighted report density.
  - city-level pressure index.
- Load:
  - features table (`station_features_timeseries`).

### Models
- Model A: `fuel_unavailable_prob` (binary classification).
- Model B: `high_congestion_prob` (binary classification).
- Model C: `eta_recovery_minutes` (regression).

### Training
- Weekly retrain schedule.
- Time-based split (no random leakage).
- Metrics:
  - AUC / PR-AUC for classification.
  - MAE for ETA regression.
- Register model with version + metrics.

### Inference
- Trigger every 15 minutes per active station.
- Run model on latest feature window.
- Write to `model_predictions`.
- Expose via `/predictions/:stationId`.

### Monitoring
- Data drift (feature distribution drift).
- Concept drift (prediction vs observed outcome).
- Alert if:
  - AUC drops below target.
  - missing features exceed threshold.
  - inference latency > 1s P95.

## 6) Security & Privacy Checklist

- JWT access token + refresh token rotation.
- RBAC:
  - user
  - station_manager
  - admin
- Rate limits:
  - per IP
  - per user
  - per endpoint
- Input validation at edge (Zod/Joi) + strict enums.
- SQL injection protection via parameterized queries.
- Upload/image scanning and signed URLs only.
- Audit log for all privileged actions.
- Encrypt data in transit (TLS 1.2+) and at rest.
- Location privacy:
  - store only needed precision for analytics.
  - separate raw precise location retention (short period).
- Minimal data retention + periodic purge jobs.
- Abuse controls:
  - bot detection for report endpoints.
  - device fingerprint heuristics (privacy-safe).

## 7) MVP Delivery Plan (6 Sprints, 2 weeks each)

### Sprint 1
- Monorepo setup, Docker compose, CI basics.
- Auth + user roles.
- Core DB schema migrations (Postgres + PostGIS).
- Seed stations importer.

### Sprint 2
- Map UI (Next.js + Mapbox) with station markers and filters.
- `GET /stations`, `GET /stations/:id`, `GET /stations/nearby`.
- Realtime channel skeleton (SSE/WebSocket).

### Sprint 3
- Crowd reporting flow (`POST /reports`).
- Distance/rate limit validation.
- Queue workers + first verification algorithm.

### Sprint 4
- Trust score engine + fraud rules v1.
- Station manager dashboard + official updates.
- Notification preferences + push job pipeline.

### Sprint 5
- ML baseline models + inference endpoint.
- Analytics overview dashboard (admin).
- Observability stack + alert rules.

### Sprint 6
- Hardening + security review.
- Performance/load tuning.
- UAT, bug fixing, release checklist, production launch.

## 8) Risks & Mitigations

- Low-quality crowd data.
  - Mitigation: trust weighting, distance checks, official overrides.
- Coordinated fake reports.
  - Mitigation: anomaly detection, burst limits, collusion scoring.
- Sparse data in smaller cities.
  - Mitigation: fallback to official updates + uncertainty labels.
- Intermittent network quality.
  - Mitigation: offline-first UI caching + retry queues.
- Model degradation over time.
  - Mitigation: drift monitoring + scheduled retraining.
- Operational complexity.
  - Mitigation: phased rollout, feature flags, strong observability.

## 9) JSON Examples

### A) `POST /reports` request
```json
{
  "stationId": "4b64cb0d-3062-4d5b-b2d2-6f0ea644fbf1",
  "fuelStatus": "available",
  "congestion": "high",
  "lat": 32.8923,
  "lng": 13.1802,
  "imageUrl": "https://cdn.example.com/reports/r_92831.jpg"
}
```

### B) `POST /reports` response
```json
{
  "reportId": "7c95a08f-55cd-44ea-b5d5-83a0a9534100",
  "verificationState": "pending",
  "queued": true,
  "message": "Report submitted successfully"
}
```

### C) `GET /stations/nearby` response
```json
{
  "items": [
    {
      "stationId": "4b64cb0d-3062-4d5b-b2d2-6f0ea644fbf1",
      "name": "محطة النصر",
      "city": "Tripoli",
      "distanceMeters": 820,
      "fuelStatus": "low",
      "congestion": "medium",
      "confidence": 0.74,
      "lastVerifiedAt": "2026-03-06T08:10:22Z"
    }
  ],
  "nextCursor": null
}
```

### D) `POST /notifications/subscribe` request
```json
{
  "city": "Tripoli",
  "maxRadiusKm": 8,
  "notifyGasoline": true,
  "notifyDiesel": false,
  "notifyHighCongestion": true
}
```

### E) `GET /predictions/:stationId` response
```json
{
  "stationId": "4b64cb0d-3062-4d5b-b2d2-6f0ea644fbf1",
  "modelVersion": "v1.3.0",
  "fuelUnavailableProb": 0.67,
  "highCongestionProb": 0.81,
  "etaRecoveryMinutes": 95,
  "predictedAt": "2026-03-06T08:15:00Z",
  "validUntil": "2026-03-06T09:15:00Z"
}
```

## 10) Test Plan (Unit / Integration / E2E / Load)

### Unit Tests
- Validation schemas for all API inputs.
- Verification weight functions:
  - trust
  - distance
  - recency
  - image factor
- Trust score update logic.
- Fraud rule evaluators.

### Integration Tests
- API + DB transactions for reports lifecycle.
- Worker queue processing and station status update.
- PostGIS nearby query correctness.
- Notification preference filtering.

### E2E Tests
- User flow: open map -> find nearby station -> submit report -> receive realtime update.
- Station manager flow: official update -> state override visible on map.
- Admin flow: analytics dashboard renders key metrics.

### Load / Performance Tests
- `GET /stations/nearby` under concurrent users.
- Report ingestion throughput (peak events).
- Realtime fanout latency target: <5s end-to-end.
- P95 API latency:
  - nearby query < 400ms
  - report submit < 300ms

### Security Tests
- AuthN/AuthZ negative tests.
- Rate limiting and abuse resistance.
- Injection tests and payload fuzzing.
- Audit log integrity checks.

