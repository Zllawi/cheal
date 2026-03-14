"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { CircleMarker, MapContainer, Marker, Pane, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { fetchGasLocationsFromOverpass } from "./api";
import type { MapBounds, OSMGasLocation } from "./types";

interface BoundsPayload {
  bounds: MapBounds;
  zoom: number;
}

interface GasMapProps {
  selectedId: string | null;
  highlightedIds: string[];
  onSelect: (id: string) => void;
  onDataChange?: (items: OSMGasLocation[]) => void;
  userPosition?: { lat: number; lng: number } | null;
  center?: [number, number];
}

const GAS_MIN_FETCH_ZOOM = 10;
const GAS_FETCH_INTERVAL_MS = 12_000;
const GAS_FETCH_DEBOUNCE_MS = 1000;
const GAS_MAX_BOUNDS_AREA_DEG2 = 0.18;

export function GasMap({
  selectedId,
  highlightedIds,
  onSelect,
  onDataChange,
  userPosition,
  center = [27, 17]
}: GasMapProps) {
  const [items, setItems] = useState<OSMGasLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lastKeyRef = useRef<string>("");
  const lastFetchAtRef = useRef<number>(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeFetchIdRef = useRef<number>(0);

  const highlightedSet = useMemo(() => new Set(highlightedIds), [highlightedIds]);

  const fetchByBounds = useCallback(
    async ({ bounds, zoom }: BoundsPayload) => {
      if (zoom < GAS_MIN_FETCH_ZOOM) {
        setError(null);
        setNotice(`كبّر الخريطة (Zoom ${GAS_MIN_FETCH_ZOOM}+) لعرض موزعي الغاز`);
        return;
      }

      const area = Math.abs((bounds.north - bounds.south) * (bounds.east - bounds.west));
      if (area > GAS_MAX_BOUNDS_AREA_DEG2) {
        setError(null);
        setNotice("نطاق الخريطة واسع جدًا. قرّب أكثر لعرض موزعي الغاز.");
        return;
      }

      const key = [
        bounds.south.toFixed(1),
        bounds.west.toFixed(1),
        bounds.north.toFixed(1),
        bounds.east.toFixed(1)
      ].join("|");

      if (lastKeyRef.current === key) {
        return;
      }

      const now = Date.now();
      if (now - lastFetchAtRef.current < GAS_FETCH_INTERVAL_MS) {
        return;
      }

      lastKeyRef.current = key;
      lastFetchAtRef.current = now;
      const fetchId = ++activeFetchIdRef.current;

      setLoading(true);
      setError(null);
      setNotice(null);

      try {
        const result = await fetchGasLocationsFromOverpass(bounds);
        if (fetchId !== activeFetchIdRef.current) {
          return;
        }
        setItems(result);
        onDataChange?.(result);
      } catch (fetchError) {
        if (fetchId !== activeFetchIdRef.current) {
          return;
        }

        const message =
          fetchError instanceof Error ? fetchError.message : "تعذر تحميل مواقع الغاز من OpenStreetMap";

        if (message.toLowerCase().includes("overpass")) {
          setNotice(message);
          setError(null);
        } else {
          setError(message);
        }
      } finally {
        if (fetchId === activeFetchIdRef.current) {
          setLoading(false);
        }
      }
    },
    [onDataChange]
  );

  const scheduleFetch = useCallback(
    (payload: BoundsPayload) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        void fetchByBounds(payload);
      }, GAS_FETCH_DEBOUNCE_MS);
    },
    [fetchByBounds]
  );

  useEffect(
    () => () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    },
    []
  );

  return (
    <div className="relative h-[540px] overflow-hidden rounded-2xl border border-black/10 shadow-md">
      <div className="pointer-events-none absolute left-3 top-3 z-[1200] rounded-lg bg-white/90 px-3 py-2 text-xs shadow">
        <div className="font-semibold">موزعو الغاز</div>
        <div>{loading ? "جاري التحديث..." : `${items.length} موقع`}</div>
        {notice ? <div className="text-amber-700">{notice}</div> : null}
        {error ? <div className="text-red-600">{error}</div> : null}
      </div>

      <MapContainer center={center} zoom={6} scrollWheelZoom className="h-full w-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <BoundsWatcher onChange={scheduleFetch} />
        <UserFocus userPosition={userPosition ?? null} />

        <Pane name="gasPane" style={{ zIndex: 760 }}>
          {items.map((item) => {
            const isHighlighted = highlightedSet.has(item.id);
            const icon = buildGasIcon(item, isHighlighted);
            return (
              <Marker
                key={item.id}
                pane="gasPane"
                position={[item.lat, item.lng]}
                icon={icon}
                zIndexOffset={isHighlighted ? 1800 : 1300}
                eventHandlers={{
                  click: () => onSelect(item.id)
                }}
              >
                <Popup>
                  <div className="min-w-[180px] space-y-2 text-right">
                    <div className="font-semibold">{item.nameAr}</div>
                    <div className="text-xs text-black/70">{item.city || "ليبيا"}</div>
                    <div className="text-sm">
                      النوع: {item.sourceType === "distributor" ? "موزع غاز" : "محطة توفر الغاز"}
                    </div>
                    <div className="text-sm">
                      التوفر:{" "}
                      <span className={item.hasLpg ? "text-emerald-700" : "text-gray-500"}>
                        {item.hasLpg ? "يوفر غاز" : "غير مؤكد"}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="w-full rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-600"
                      onClick={() => openRouteToLocation(item.lat, item.lng, userPosition ?? null)}
                    >
                      تحديد مسار الذهاب
                    </button>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </Pane>

        {selectedId ? (
          <Pane name="selectedPane" style={{ zIndex: 920 }}>
            {items
              .filter((item) => item.id === selectedId)
              .map((item) => (
                <CircleMarker
                  key={`selected-${item.id}`}
                  pane="selectedPane"
                  center={[item.lat, item.lng]}
                  radius={14}
                  color="#f97316"
                  fillColor="#f97316"
                  fillOpacity={0.2}
                  weight={2}
                />
              ))}
          </Pane>
        ) : null}

        {userPosition ? (
          <Pane name="userPane" style={{ zIndex: 930 }}>
            <CircleMarker
              pane="userPane"
              center={[userPosition.lat, userPosition.lng]}
              radius={9}
              color="#0d6efd"
              fillColor="#4ea2ff"
              fillOpacity={0.95}
              weight={3}
            />
            <CircleMarker
              pane="userPane"
              center={[userPosition.lat, userPosition.lng]}
              radius={20}
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

function BoundsWatcher({ onChange }: { onChange: (payload: BoundsPayload) => void }) {
  const map = useMapEvents({
    moveend: () => {
      const b = map.getBounds();
      onChange({
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
    onChange({
      bounds: {
        south: b.getSouth(),
        west: b.getWest(),
        north: b.getNorth(),
        east: b.getEast()
      },
      zoom: map.getZoom()
    });
  }, [map, onChange]);

  return null;
}

function UserFocus({ userPosition }: { userPosition: { lat: number; lng: number } | null }) {
  const map = useMap();
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!userPosition || focusedRef.current) {
      return;
    }
    map.flyTo([userPosition.lat, userPosition.lng], 13, { duration: 1 });
    focusedRef.current = true;
  }, [map, userPosition]);

  return null;
}

function buildGasIcon(item: OSMGasLocation, highlighted: boolean): L.DivIcon {
  const color = item.sourceType === "distributor" ? "#f97316" : "#1fa15f";
  const ring = item.hasLpg ? "#1d4ed8" : "#ffffff";
  const size = highlighted ? 38 : 34;
  const emoji = item.sourceType === "distributor" ? "🛢️" : "⛽";

  return L.divIcon({
    className: "gas-marker-icon",
    html: `
      <div style="
        width: ${size}px;
        height: ${size}px;
        border-radius: 999px;
        background: ${color};
        border: 3px solid ${highlighted ? "#facc15" : ring};
        color: #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        box-shadow: 0 6px 16px rgba(0,0,0,0.35);
      ">${emoji}</div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size - 3],
    popupAnchor: [0, -(size - 6)]
  });
}

function openRouteToLocation(lat: number, lng: number, userPosition: { lat: number; lng: number } | null): void {
  const destination = `${lat},${lng}`;
  const origin = userPosition ? `${userPosition.lat},${userPosition.lng}` : null;

  const url = origin
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;

  window.open(url, "_blank", "noopener,noreferrer");
}
