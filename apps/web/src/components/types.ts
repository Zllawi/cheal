export type FuelStatus = "available" | "low" | "unavailable" | "closed";
export type DieselStatus = "available" | "low" | "unavailable";
export type Congestion = "none" | "medium" | "high";
export type AppRole = "user" | "station_manager" | "admin";

export interface AuthUserProfile {
  id: string;
  role: AppRole;
  city?: string | null;
  fullName?: string | null;
  phoneE164?: string | null;
  address?: string | null;
}

export interface Station {
  id?: string;
  stationId?: string;
  osmId?: string | null;
  name: string;
  city: string;
  supportsGasoline?: boolean;
  supportsDiesel?: boolean;
  address?: string;
  lat: number;
  lng: number;
  fuelStatus: FuelStatus;
  dieselStatus?: DieselStatus;
  congestion: Congestion;
  confidence: number;
  distanceMeters?: number;
  lastVerifiedAt?: string | null;
}

export interface MapBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface OSMFuelStation {
  id: string;
  lat: number;
  lng: number;
  name: string;
  nameAr: string;
  hasDiesel: boolean;
  fuelStatus: Exclude<FuelStatus, "closed">;
}

export interface OSMGasLocation {
  id: string;
  lat: number;
  lng: number;
  name: string;
  nameAr: string;
  city?: string;
  hasLpg: boolean;
  sourceType: "distributor" | "station";
}

export interface SupportThread {
  id: string;
  user: {
    id: string;
    fullName: string;
    phoneE164?: string | null;
  };
  subject?: string | null;
  status: "open" | "closed";
  unreadForAdmin: number;
  unreadForUser: number;
  lastMessageAt?: string | null;
  lastMessagePreview?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface SupportMessage {
  id: string;
  threadId: string;
  senderId: string;
  senderRole: AppRole;
  body: string;
  readByAdmin: boolean;
  readByUser: boolean;
  createdAt: string;
}
