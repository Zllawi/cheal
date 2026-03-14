import { EventEmitter } from "node:events";

export interface StationUpdatedEvent {
  stationId: string;
  fuelStatus: "available" | "low" | "unavailable" | "closed";
  dieselStatus: "available" | "low" | "unavailable";
  congestion: "none" | "medium" | "high";
  confidence: number;
  at: string;
}

class RealtimeBroker {
  private emitter = new EventEmitter();

  publishStationUpdated(payload: StationUpdatedEvent): void {
    this.emitter.emit("station.updated", payload);
  }

  onStationUpdated(listener: (payload: StationUpdatedEvent) => void): () => void {
    this.emitter.on("station.updated", listener);
    return () => this.emitter.off("station.updated", listener);
  }
}

export const realtimeBroker = new RealtimeBroker();
