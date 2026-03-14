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
  role VARCHAR(20) NOT NULL DEFAULT 'user',
  city VARCHAR(80),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trust_scores (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  score NUMERIC(5,2) NOT NULL DEFAULT 50.00,
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
  current_confidence NUMERIC(4,3) NOT NULL DEFAULT 0.000,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stations_location_gist ON stations USING GIST(location);
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
  verification_state VARCHAR(20) NOT NULL DEFAULT 'pending',
  verification_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_station_time ON crowd_reports(station_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_user_time ON crowd_reports(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_location_gist ON crowd_reports USING GIST(report_location);

CREATE TABLE IF NOT EXISTS station_official_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  manager_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fuel_status fuel_status_enum NOT NULL,
  congestion congestion_enum NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_official_station_time ON station_official_updates(station_id, created_at DESC);

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

CREATE INDEX IF NOT EXISTS idx_station_history_station_time ON station_status_history(station_id, snapshot_at DESC);

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
  type VARCHAR(40) NOT NULL,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  payload JSONB,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_time ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS fraud_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID REFERENCES crowd_reports(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  station_id UUID REFERENCES stations(id) ON DELETE SET NULL,
  flag_type VARCHAR(60) NOT NULL,
  score NUMERIC(5,4) NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_fraud_user_time ON fraud_flags(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_station_time ON fraud_flags(station_id, created_at DESC);

CREATE TABLE IF NOT EXISTS model_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  model_name VARCHAR(80) NOT NULL,
  model_version VARCHAR(40) NOT NULL,
  predict_window_minutes INT NOT NULL,
  fuel_unavailable_prob NUMERIC(5,4) NOT NULL,
  high_congestion_prob NUMERIC(5,4) NOT NULL,
  eta_recovery_minutes INT,
  features_hash VARCHAR(128),
  predicted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_predictions_station_time ON model_predictions(station_id, predicted_at DESC);
