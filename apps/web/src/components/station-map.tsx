"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { CircleMarker, MapContainer, Marker, Pane, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { fetchFuelStationsFromOverpass } from "./api";
import type { FuelStatus, MapBounds, OSMFuelStation, Station } from "./types";

const statusColorMap: Record<Station["fuelStatus"], string> = {
  available: "#1fa15f",
  low: "#e3ad23",
  unavailable: "#e04848",
  closed: "#111111"
};

const osmStatusColorMap: Record<Exclude<FuelStatus, "closed">, string> = {
  available: "#1fa15f",
  low: "#ff8f1f",
  unavailable: "#e04848"
};

const benghaziHighlightColor = "#19c15f";
const dieselHighlightColor = "#1d4ed8";
const OSM_MIN_FETCH_ZOOM = 10;
const OSM_FETCH_DEBOUNCE_MS = 1100;
const OSM_MIN_FETCH_INTERVAL_MS = 12_000;
const OSM_MAX_BOUNDS_AREA_DEG2 = 0.18;

interface BoundsChangePayload {
  bounds: MapBounds;
  zoom: number;
}

interface StationMapProps {
  stations: Station[];
  highlightedStationIds?: string[];
  selectedStationId: string | null;
  onSelect: (stationId: string) => void;
  canEdit?: boolean;
  onRequestStationUpdate?: (station: OSMFuelStation) => void;
  onRequestEnableDiesel?: (payload: { stationId?: string; osmStation?: OSMFuelStation }) => void;
  userPosition?: { lat: number; lng: number } | null;
  followUser?: boolean;
  center?: [number, number];
}

export function StationMap({
  stations,
  highlightedStationIds = [],
  selectedStationId,
  onSelect,
  canEdit = false,
  onRequestStationUpdate,
  onRequestEnableDiesel,
  userPosition,
  followUser = true,
  center = [27.0, 17.0]
}: StationMapProps) {
  const [osmStations, setOsmStations] = useState<OSMFuelStation[]>([]);
  const [loadingOsm, setLoadingOsm] = useState(false);
  const [osmError, setOsmError] = useState<string | null>(null);
  const [osmNotice, setOsmNotice] = useState<string | null>(null);
  const lastBoundsKeyRef = useRef<string>("");
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFetchAtRef = useRef<number>(0);
  const activeFetchIdRef = useRef<number>(0);

  const fetchByBounds = useCallback(async ({ bounds, zoom }: BoundsChangePayload) => {
    if (zoom < OSM_MIN_FETCH_ZOOM) {
      setOsmError(null);
      setOsmNotice(`كبّر الخريطة (Zoom ${OSM_MIN_FETCH_ZOOM}+) لعرض محطات OSM`);
      return;
    }

    const boundsArea = Math.abs((bounds.north - bounds.south) * (bounds.east - bounds.west));
    if (boundsArea > OSM_MAX_BOUNDS_AREA_DEG2) {
      setOsmError(null);
      setOsmNotice("نطاق الخريطة واسع جدًا. قرّب أكثر لعرض المحطات.");
      return;
    }

    const key = [
      bounds.south.toFixed(1),
      bounds.west.toFixed(1),
      bounds.north.toFixed(1),
      bounds.east.toFixed(1)
    ].join("|");

    if (key === lastBoundsKeyRef.current) {
      return;
    }

    const now = Date.now();
    if (now - lastFetchAtRef.current < OSM_MIN_FETCH_INTERVAL_MS) {
      return;
    }

    lastBoundsKeyRef.current = key;
    lastFetchAtRef.current = now;
    const fetchId = ++activeFetchIdRef.current;

    setLoadingOsm(true);
    setOsmError(null);
    setOsmNotice(null);
    try {
      const fetched = await fetchFuelStationsFromOverpass(bounds);
      if (fetchId !== activeFetchIdRef.current) {
        return;
      }
      setOsmStations(fetched);
    } catch (error) {
      if (fetchId !== activeFetchIdRef.current) {
        return;
      }

      const message = error instanceof Error ? error.message : "تعذر تحميل محطات الوقود من OpenStreetMap";
      if (message.toLowerCase().includes("overpass")) {
        setOsmNotice(message);
        setOsmError(null);
      } else {
        setOsmError(message);
      }
    } finally {
      if (fetchId === activeFetchIdRef.current) {
        setLoadingOsm(false);
      }
    }
  }, []);

  const scheduleBoundsFetch = useCallback(
    (payload: BoundsChangePayload) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        void fetchByBounds(payload);
      }, OSM_FETCH_DEBOUNCE_MS);
    },
    [fetchByBounds]
  );

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const osmStationsWithStatus = useMemo(
    () =>
      osmStations.map((station) => {
        const fuelStatus = inferFuelStatusFromKnownStations(station, stations);
        const hasDiesel = station.hasDiesel || inferDieselCapabilityFromKnownStations(station, stations);
        return {
          ...station,
          fuelStatus,
          hasDiesel
        };
      }),
    [osmStations, stations]
  );

  const highlightedIdSet = useMemo(() => new Set(highlightedStationIds), [highlightedStationIds]);
  const highlightedStations = useMemo(
    () => stations.filter((station) => highlightedIdSet.has(station.id ?? station.stationId ?? "")),
    [stations, highlightedIdSet]
  );

  return (
    <div className="relative h-[540px] overflow-hidden rounded-2xl border border-black/10 shadow-md">
      <div className="pointer-events-none absolute left-3 top-3 z-[1200] rounded-lg bg-white/90 px-3 py-2 text-xs shadow">
        <div className="font-semibold">محطات OpenStreetMap</div>
        <div>{loadingOsm ? "جاري التحديث..." : `${osmStationsWithStatus.length} محطة`}</div>
        {osmNotice ? <div className="text-amber-700">{osmNotice}</div> : null}
        {osmError ? <div className="text-red-600">{osmError}</div> : null}
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 z-[1200] rounded-lg bg-white/90 px-3 py-2 text-xs shadow">
        <div className="mb-1 font-semibold">حالة الوقود</div>
        <LegendRow color={osmStatusColorMap.available} label="🟢 الوقود متوفر" />
        <LegendRow color={osmStatusColorMap.low} label="🟡 كمية قليلة" />
        <LegendRow color={osmStatusColorMap.unavailable} label="🔴 غير متوفر" />
        <LegendRow color={dieselHighlightColor} label="🔵 تصنيف ديزل" />
        {highlightedStationIds.length > 0 ? <LegendRow color="#f97316" label="🚩 نتيجة بحث" /> : null}
      </div>

      <MapContainer center={center} zoom={6} scrollWheelZoom className="h-full w-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <UserFocusController userPosition={userPosition ?? null} followUser={followUser} />
        <BoundsWatcher onBoundsChange={scheduleBoundsFetch} />

        {stations.map((station) => {
          const stationId = station.id ?? station.stationId ?? "";
          const isHighlighted = highlightedIdSet.has(stationId);
          const markerStyle = getBackendMarkerStyle(station);
          return (
            <CircleMarker
              key={stationId}
              center={[station.lat, station.lng]}
              radius={selectedStationId === stationId ? 11 : isHighlighted ? 10 : 8}
              color={isHighlighted ? "#f97316" : markerStyle.stroke}
              fillColor={markerStyle.fill}
              fillOpacity={0.9}
              weight={selectedStationId === stationId ? 4 : isHighlighted ? 3 : 2}
              eventHandlers={{
                click: () => onSelect(stationId)
              }}
            >
              <Popup>
                <div className="space-y-1.5 text-right">
                  <div className="font-semibold">{station.name}</div>
                  <div>{station.city}</div>
                  <div>الحالة: {fuelLabel(station.fuelStatus)}</div>
                  <div>
                    الديزل:{" "}
                    <span
                      style={{
                        color:
                          station.dieselStatus === "available"
                            ? dieselHighlightColor
                            : station.dieselStatus === "low"
                              ? "#f59e0b"
                              : "#6b7280"
                      }}
                    >
                      {dieselLabel(
                        station.dieselStatus ?? (station.supportsDiesel ? "available" : "unavailable")
                      )}
                    </span>
                  </div>
                  <div>الازدحام: {congestionLabel(station.congestion)}</div>
                  <div className="text-xs text-black/70">الثقة: {Math.round((station.confidence ?? 0) * 100)}%</div>
                  <div className="text-xs text-black/60">آخر تحديث: {formatStationTime(station.lastVerifiedAt)}</div>
                  <div className="mt-2 grid grid-cols-1 gap-2">
                    {canEdit ? (
                      <button
                        type="button"
                        className="rounded-lg bg-brand-800 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700"
                        onClick={() => onSelect(stationId)}
                      >
                        تعديل من القائمة الجانبية
                      </button>
                    ) : null}
                    {canEdit && !station.supportsDiesel ? (
                      <button
                        type="button"
                        className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-600"
                        onClick={() => onRequestEnableDiesel?.({ stationId })}
                      >
                        تفعيل توفر الديزل
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-600"
                      onClick={() => openRouteToStation(station.lat, station.lng, userPosition ?? null)}
                    >
                      تحديد مسار الذهاب
                    </button>
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}

        {highlightedStations.length > 0 ? (
          <Pane name="searchResultsPane" style={{ zIndex: 910 }}>
            {highlightedStations.map((station) => {
              const stationId = station.id ?? station.stationId ?? "";
              return (
                <Marker
                  key={`result-${stationId}`}
                  pane="searchResultsPane"
                  position={[station.lat, station.lng]}
                  icon={buildSearchFlagIcon()}
                  zIndexOffset={1900}
                  eventHandlers={{
                    click: () => onSelect(stationId)
                  }}
                />
              );
            })}
          </Pane>
        ) : null}

        <Pane name="fuelStationsPane" style={{ zIndex: 750 }}>
          {osmStationsWithStatus.map((station) => (
            <Marker
              key={station.id}
              pane="fuelStationsPane"
              position={[station.lat, station.lng]}
              icon={buildFuelIcon(station.fuelStatus, station.hasDiesel)}
              zIndexOffset={1500}
            >
              <Popup>
                <div className="min-w-[190px] space-y-2 text-right">
                  <div className="font-semibold">{station.nameAr}</div>
                  <div className="text-xs text-black/60">النوع: محطة وقود</div>
                  <div className="text-sm">البنزين: {fuelLabel(station.fuelStatus)}</div>
                  <div className="text-sm">
                    الديزل:{" "}
                    <span style={{ color: station.hasDiesel ? dieselHighlightColor : "#6b7280" }}>
                      {station.hasDiesel ? "متوفر" : "غير متوفر"}
                    </span>
                  </div>
                  {canEdit && !station.hasDiesel ? (
                    <button
                      type="button"
                      className="w-full rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-600"
                      onClick={() => onRequestEnableDiesel?.({ osmStation: station })}
                    >
                      تعديل المحطة لتوفر الديزل
                    </button>
                  ) : null}
                  {canEdit ? (
                    <button
                      type="button"
                      className="w-full rounded-lg bg-brand-800 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700"
                      onClick={() => onRequestStationUpdate?.(station)}
                    >
                      تحديث حالة الوقود
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="w-full rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-600"
                    onClick={() => openRouteToStation(station.lat, station.lng, userPosition ?? null)}
                  >
                    تحديد مسار الذهاب
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}
        </Pane>

        {userPosition ? (
          <Pane name="userPane" style={{ zIndex: 920 }}>
            <CircleMarker
              pane="userPane"
              center={[userPosition.lat, userPosition.lng]}
              radius={10}
              color="#0d6efd"
              fillColor="#4ea2ff"
              fillOpacity={0.95}
              weight={3}
            >
              <Popup>
                <div className="text-right">
                  <div className="font-semibold">موقعك الحالي</div>
                  <div className="text-xs text-black/70">تم التركيز على موقعك</div>
                </div>
              </Popup>
            </CircleMarker>
            <CircleMarker
              pane="userPane"
              center={[userPosition.lat, userPosition.lng]}
              radius={24}
              color="#4ea2ff"
              fillColor="#4ea2ff"
              fillOpacity={0.15}
              weight={1}
            />
          </Pane>
        ) : null}
      </MapContainer>
    </div>
  );
}

function UserFocusController({
  userPosition,
  followUser
}: {
  userPosition: { lat: number; lng: number } | null;
  followUser: boolean;
}) {
  const map = useMap();
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!userPosition) {
      return;
    }

    const targetZoom = 14;
    const shouldFocus = followUser || !focusedRef.current;
    if (!shouldFocus) {
      return;
    }

    map.flyTo([userPosition.lat, userPosition.lng], targetZoom, { duration: 1 });
    focusedRef.current = true;
  }, [userPosition, followUser, map]);

  return null;
}

function BoundsWatcher({ onBoundsChange }: { onBoundsChange: (payload: BoundsChangePayload) => void }) {
  const map = useMapEvents({
    moveend: () => {
      const b = map.getBounds();
      onBoundsChange({
        bounds: {
          south: b.getSouth(),
          west: b.getWest(),
          north: b.getNorth(),
          east: b.getEast()
        },
        zoom: map.getZoom()
      });
    }
  });

  useEffect(() => {
    const b = map.getBounds();
    onBoundsChange({
      bounds: {
        south: b.getSouth(),
        west: b.getWest(),
        north: b.getNorth(),
        east: b.getEast()
      },
      zoom: map.getZoom()
    });
  }, [map, onBoundsChange]);

  return null;
}

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      <span>{label}</span>
    </div>
  );
}

function buildFuelIcon(status: Exclude<FuelStatus, "closed">, hasDiesel: boolean): L.DivIcon {
  const fillColor = osmStatusColorMap[status];
  const borderColor = hasDiesel ? dieselHighlightColor : "#ffffff";
  const borderWidth = hasDiesel ? 3 : 2;

  return L.divIcon({
    className: "fuel-marker-icon",
    html: `
      <div style="
        width: 36px;
        height: 36px;
        border-radius: 999px;
        background: ${fillColor};
        border: ${borderWidth}px solid ${borderColor};
        color: #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        box-shadow: 0 6px 16px rgba(0,0,0,0.35);
      ">⛽</div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 32],
    popupAnchor: [0, -28]
  });
}

function buildSearchFlagIcon(): L.DivIcon {
  return L.divIcon({
    className: "search-result-flag-icon",
    html: `
      <div style="
        width: 28px;
        height: 28px;
        border-radius: 999px;
        background: #ffffff;
        border: 2px solid #f97316;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        box-shadow: 0 4px 10px rgba(0,0,0,0.25);
      ">🚩</div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 24],
    popupAnchor: [0, -22]
  });
}

function getBackendMarkerStyle(station: Station): { fill: string; stroke: string } {
  const fill =
    station.city.trim().toLowerCase() === "benghazi" ? benghaziHighlightColor : statusColorMap[station.fuelStatus];

  return {
    fill,
    stroke: station.supportsDiesel ? dieselHighlightColor : fill
  };
}

function fuelLabel(status: FuelStatus | Exclude<FuelStatus, "closed">): string {
  if (status === "available") return "متوفر";
  if (status === "low") return "كمية قليلة";
  if (status === "unavailable") return "غير متوفر";
  return "مغلقة";
}

function dieselLabel(status: "available" | "low" | "unavailable"): string {
  if (status === "available") return "متوفر";
  if (status === "low") return "كمية قليلة";
  return "غير متوفر";
}

function congestionLabel(value: Station["congestion"]): string {
  if (value === "none") return "لا يوجد";
  if (value === "medium") return "متوسط";
  return "شديد";
}

function formatStationTime(value?: string | null): string {
  if (!value) {
    return "غير متوفر";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "غير متوفر";
  }

  return new Intl.DateTimeFormat("ar-LY", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

function inferFuelStatusFromKnownStations(
  osmStation: OSMFuelStation,
  knownStations: Station[]
): Exclude<FuelStatus, "closed"> {
  let best: { distance: number; status: Exclude<FuelStatus, "closed"> } | null = null;

  for (const station of knownStations) {
    const distance = distanceMeters(osmStation.lat, osmStation.lng, station.lat, station.lng);
    if (distance > 120) {
      continue;
    }

    const status = station.fuelStatus === "closed" ? "unavailable" : station.fuelStatus;
    if (!best || distance < best.distance) {
      best = { distance, status };
    }
  }

  return best?.status ?? "low";
}

function inferDieselCapabilityFromKnownStations(osmStation: OSMFuelStation, knownStations: Station[]): boolean {
  let nearest: { distance: number; hasDiesel: boolean } | null = null;

  for (const station of knownStations) {
    const distance = distanceMeters(osmStation.lat, osmStation.lng, station.lat, station.lng);
    if (distance > 120) {
      continue;
    }

    const hasDiesel =
      station.dieselStatus === "available" ||
      station.dieselStatus === "low" ||
      Boolean(station.supportsDiesel);

    if (!nearest || distance < nearest.distance) {
      nearest = { distance, hasDiesel };
    }
  }

  return nearest?.hasDiesel ?? false;
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusM = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusM * c;
}

function openRouteToStation(lat: number, lng: number, userPosition: { lat: number; lng: number } | null): void {
  const destination = `${lat},${lng}`;
  const origin = userPosition ? `${userPosition.lat},${userPosition.lng}` : null;

  const url = origin
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;

  window.open(url, "_blank", "noopener,noreferrer");
}
