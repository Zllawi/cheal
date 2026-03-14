"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Filter, Locate, MapPin, Search } from "lucide-react";
import type { OSMGasLocation } from "./types";

const ClientGasMap = dynamic(() => import("./gas-map").then((module) => module.GasMap), {
  ssr: false,
  loading: () => (
    <div className="h-[540px] rounded-2xl border border-black/10 bg-white/70 p-4 shadow-md">
      جاري تحميل خريطة الغاز...
    </div>
  )
});

export function GasDashboard() {
  const [items, setItems] = useState<OSMGasLocation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [cityFilter, setCityFilter] = useState("all");
  const [userPosition, setUserPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [info, setInfo] = useState("كبّر الخريطة للحصول على مواقع الغاز.");

  const cities = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if (item.city?.trim()) {
        set.add(item.city.trim());
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (cityFilter !== "all" && (item.city ?? "") !== cityFilter) {
        return false;
      }
      if (!q) {
        return true;
      }
      return item.nameAr.toLowerCase().includes(q) || item.name.toLowerCase().includes(q);
    });
  }, [items, cityFilter, search]);

  const hasFilter = search.trim().length > 0 || cityFilter !== "all";
  const highlightedIds = useMemo(
    () => (hasFilter ? filtered.map((item) => item.id) : []),
    [filtered, hasFilter]
  );

  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);

  useEffect(() => {
    if (!selectedId && items.length > 0) {
      setSelectedId(items[0].id);
      return;
    }

    if (!selectedId) {
      return;
    }

    const exists = items.some((item) => item.id === selectedId);
    if (!exists) {
      setSelectedId(items[0]?.id ?? null);
    }
  }, [items, selectedId]);

  useEffect(() => {
    if (!hasFilter) {
      return;
    }

    if (filtered.length === 0) {
      setSelectedId(null);
      return;
    }

    if (!selectedId || !filtered.some((item) => item.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, hasFilter, selectedId]);

  async function handleLocate(): Promise<void> {
    if (!navigator.geolocation) {
      setInfo("المتصفح لا يدعم تحديد الموقع.");
      return;
    }

    setInfo("جاري تحديد موقعك...");
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60000
        })
      );
      setUserPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      setInfo("تم تحديد موقعك.");
    } catch {
      setInfo("تعذر الوصول إلى موقعك.");
    }
  }

  return (
    <section className="space-y-4">
      <header className="rounded-2xl border border-black/10 bg-white/80 p-4 shadow-md backdrop-blur">
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-2xl font-bold text-brand-900">تواجد الغاز</h2>
            <p className="text-sm text-black/70">
              اعرض موزعي الغاز ومحطات توفر الغاز القريبة مع إمكانية تحديد مسار الذهاب.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_190px_auto]">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-black/45" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ابحث عن موزع غاز..."
                className="w-full rounded-xl border border-black/15 bg-white px-10 py-2.5 text-sm shadow-sm"
              />
            </div>

            <div className="relative">
              <Filter size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-black/45" />
              <select
                value={cityFilter}
                onChange={(event) => setCityFilter(event.target.value)}
                className="w-full rounded-xl border border-black/15 bg-white px-10 py-2.5 text-sm shadow-sm"
              >
                <option value="all">كل المدن</option>
                {cities.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => void handleLocate()}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand-700 px-4 py-2.5 text-sm font-semibold text-brand-800 hover:bg-brand-50"
            >
              <Locate size={16} />
              موقعي
            </button>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <ClientGasMap
          selectedId={selectedId}
          highlightedIds={highlightedIds}
          onSelect={setSelectedId}
          onDataChange={(nextItems) => {
            setItems(nextItems);
            setInfo(`تم تحميل ${nextItems.length} موقع غاز`);
          }}
          userPosition={userPosition}
          center={userPosition ? [userPosition.lat, userPosition.lng] : [27.0, 17.0]}
        />

        <aside className="space-y-4 lg:max-h-[540px] lg:overflow-y-auto lg:pr-1">
          <div className="rounded-2xl border border-sky-200/80 bg-gradient-to-b from-white to-sky-50/70 p-4 shadow-md">
            <h3 className="mb-2 text-lg font-bold">ملخص النتائج</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <StatPill title="إجمالي المواقع" value={`${items.length}`} />
              <StatPill title="مطابقة الفلتر" value={`${filtered.length}`} />
            </div>
          </div>

          <div className="rounded-2xl border border-amber-200/80 bg-gradient-to-b from-white to-amber-50/70 p-4 shadow-md">
            <h3 className="mb-3 flex items-center gap-2 text-lg font-bold">
              <MapPin size={18} />
              تفاصيل الموقع المحدد
            </h3>

            {!selected ? (
              <p className="text-sm text-black/70">اختر نقطة من الخريطة لعرض التفاصيل.</p>
            ) : (
              <div className="space-y-2 text-sm">
                <div className="text-base font-semibold">{selected.nameAr}</div>
                <div className="text-black/70">{selected.city || "ليبيا"}</div>
                <div className="rounded-lg bg-black/5 p-2 text-xs text-black/70">
                  <div>النوع: {selected.sourceType === "distributor" ? "موزع غاز" : "محطة توفر الغاز"}</div>
                  <div>توفر الغاز: {selected.hasLpg ? "متوفر" : "غير مؤكد"}</div>
                  <div>
                    الموقع: {selected.lat.toFixed(5)}, {selected.lng.toFixed(5)}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-black/10 bg-black/[0.03] p-4 shadow-md">
            <p className="text-sm text-black/80">{info}</p>
          </div>
        </aside>
      </div>
    </section>
  );
}

function StatPill({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2 shadow-sm">
      <div className="text-[11px] text-black/55">{title}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}
