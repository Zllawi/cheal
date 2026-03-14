from datetime import datetime, timedelta, timezone
from hashlib import sha1
from fastapi import FastAPI
from pydantic import BaseModel, Field


class PredictionResponse(BaseModel):
    modelName: str = "fuelmap_baseline"
    modelVersion: str = "v1.0.0"
    predictWindowMinutes: int = 60
    fuelUnavailableProb: float = Field(ge=0, le=1)
    highCongestionProb: float = Field(ge=0, le=1)
    etaRecoveryMinutes: int | None = None
    predictedAt: str
    validUntil: str


app = FastAPI(
    title="FuelMap AI Service",
    version="0.1.0",
    description="Prediction and verification helpers for FuelMap Libya",
)


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "service": "ai",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def deterministic_probabilities(station_id: str) -> tuple[float, float, int]:
    digest = sha1(station_id.encode("utf-8")).hexdigest()
    seed_a = int(digest[:8], 16)
    seed_b = int(digest[8:16], 16)

    fuel_unavailable = 0.2 + (seed_a % 55) / 100
    high_congestion = 0.15 + (seed_b % 70) / 100
    eta = 20 + (seed_a + seed_b) % 180

    return min(max(fuel_unavailable, 0), 1), min(max(high_congestion, 0), 1), eta


@app.post("/predict/{station_id}", response_model=PredictionResponse)
def predict(station_id: str) -> PredictionResponse:
    now = datetime.now(timezone.utc)
    fuel_prob, congestion_prob, eta = deterministic_probabilities(station_id)

    return PredictionResponse(
        fuelUnavailableProb=round(fuel_prob, 4),
        highCongestionProb=round(congestion_prob, 4),
        etaRecoveryMinutes=eta,
        predictedAt=now.isoformat(),
        validUntil=(now + timedelta(minutes=60)).isoformat(),
    )
