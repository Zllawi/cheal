export type AppRole = "user" | "station_manager" | "admin";

export interface AuthUser {
  id: string;
  role: AppRole;
  city?: string | null;
}
