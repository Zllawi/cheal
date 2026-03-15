"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  Filter,
  Fuel,
  Locate,
  LogIn,
  LogOut,
  MapPin,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  User,
  X
} from "lucide-react";
import {
  createEventsConnection,
  fetchBackendHealth,
  fetchMe,
  fetchNearbyStations,
  fetchStations,
  ingestOsmStation,
  loginUser,
  logoutUser,
  registerUser,
  updateStationFuelTypes
} from "./api";
import type {
  AppRole,
  AuthUserProfile,
  Congestion,
  DieselStatus,
  FuelStatus,
  OSMFuelStation,
  Station
} from "./types";

const ClientStationMap = dynamic(
  () => import("./station-map").then((module) => module.StationMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-[540px] rounded-2xl border border-black/10 bg-white/70 p-4 shadow-md">
        جاري تحميل الخريطة...
      </div>
    )
  }
);

const fuelOptions: Array<{ label: string; value: FuelStatus }> = [
  { label: "متوفر", value: "available" },
  { label: "كمية قليلة", value: "low" },
  { label: "غير متوفر", value: "unavailable" },
  { label: "مغلقة", value: "closed" }
];

const dieselOptions: Array<{ label: string; value: DieselStatus }> = [
  { label: "متوفر", value: "available" },
  { label: "كمية قليلة", value: "low" },
  { label: "غير متوفر", value: "unavailable" }
];

const congestionOptions: Array<{ label: string; value: Congestion }> = [
  { label: "لا يوجد ازدحام", value: "none" },
  { label: "ازدحام متوسط", value: "medium" },
  { label: "ازدحام شديد", value: "high" }
];

const citySelectorOptions = [
  { value: "Tripoli", label: "طرابلس" },
  { value: "Benghazi", label: "بنغازي" },
  { value: "Misrata", label: "مصراتة" },
  { value: "Zawiya", label: "الزاوية" },
  { value: "Sabha", label: "سبها" },
  { value: "Derna", label: "درنة" },
  { value: "Sirte", label: "سرت" },
  { value: "Libya", label: "ليبيا" }
];

export function FuelDashboard() {
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);

  const [fuelStatus, setFuelStatus] = useState<FuelStatus>("available");
  const [supportsDiesel, setSupportsDiesel] = useState<boolean>(false);
  const [dieselStatus, setDieselStatus] = useState<DieselStatus>("unavailable");
  const [congestion, setCongestion] = useState<Congestion>("none");

  const [filterCity, setFilterCity] = useState<string>("all");
  const [filterFuelStatus, setFilterFuelStatus] = useState<"all" | FuelStatus>("all");
  const [filterDiesel, setFilterDiesel] = useState<"all" | "yes" | "no">("all");
  const [filterCongestion, setFilterCongestion] = useState<"all" | Congestion>("all");
  const [searchText, setSearchText] = useState<string>("");

  const [token, setToken] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<AuthUserProfile | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [showAuthPanel, setShowAuthPanel] = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [loginPhone, setLoginPhone] = useState<string>("");
  const [loginPassword, setLoginPassword] = useState<string>("");
  const [registerFullName, setRegisterFullName] = useState<string>("");
  const [registerPhone, setRegisterPhone] = useState<string>("");
  const [registerAddress, setRegisterAddress] = useState<string>("");
  const [registerPassword, setRegisterPassword] = useState<string>("");
  const [registerCity, setRegisterCity] = useState<string>("Tripoli");

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>("جاري تحميل المحطات...");
  const [geoPosition, setGeoPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [dbConnected, setDbConnected] = useState<boolean | null>(null);
  const [dbStatusText, setDbStatusText] = useState<string>("جاري الفحص...");
  const [dbCheckedAt, setDbCheckedAt] = useState<string | null>(null);

  const canEdit = authUser?.role === "admin" || authUser?.role === "station_manager";

  const selectedStation = useMemo(
    () => stations.find((station) => (station.id ?? station.stationId) === selectedStationId) ?? null,
    [selectedStationId, stations]
  );

  const availableCities = useMemo(() => {
    const set = new Set<string>();
    for (const station of stations) {
      if (station.city?.trim()) {
        set.add(station.city.trim());
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [stations]);

  const filteredStations = useMemo(() => {
    const query = searchText.trim().toLowerCase();

    return stations.filter((station) => {
      if (filterCity !== "all" && station.city !== filterCity) {
        return false;
      }
      if (filterFuelStatus !== "all" && station.fuelStatus !== filterFuelStatus) {
        return false;
      }
      if (filterCongestion !== "all" && station.congestion !== filterCongestion) {
        return false;
      }

      const stationHasDiesel =
        Boolean(station.supportsDiesel) ||
        station.dieselStatus === "available" ||
        station.dieselStatus === "low";

      if (filterDiesel === "yes" && !stationHasDiesel) {
        return false;
      }
      if (filterDiesel === "no" && stationHasDiesel) {
        return false;
      }

      if (query.length > 0) {
        const name = station.name.toLowerCase();
        const city = station.city.toLowerCase();
        if (!name.includes(query) && !city.includes(query)) {
          return false;
        }
      }

      return true;
    });
  }, [stations, filterCity, filterFuelStatus, filterCongestion, filterDiesel, searchText]);

  const hasActiveSearchOrFilter =
    searchText.trim().length > 0 ||
    filterCity !== "all" ||
    filterFuelStatus !== "all" ||
    filterDiesel !== "all" ||
    filterCongestion !== "all";

  const mapStations = stations;
  const highlightedStationIds = useMemo(
    () =>
      hasActiveSearchOrFilter
        ? filteredStations
            .map((station) => station.id ?? station.stationId)
            .filter((id): id is string => Boolean(id))
        : [],
    [hasActiveSearchOrFilter, filteredStations]
  );

  useEffect(() => {
    if (!hasActiveSearchOrFilter) {
      if (!selectedStationId && stations.length > 0) {
        setSelectedStationId(stations[0]?.id ?? stations[0]?.stationId ?? null);
      }
      return;
    }

    if (filteredStations.length === 0) {
      setSelectedStationId(null);
      return;
    }

    if (!selectedStationId) {
      setSelectedStationId(filteredStations[0]?.id ?? filteredStations[0]?.stationId ?? null);
      return;
    }

    const selectedStillVisible = filteredStations.some(
      (station) => (station.id ?? station.stationId) === selectedStationId
    );
    if (!selectedStillVisible) {
      setSelectedStationId(filteredStations[0]?.id ?? filteredStations[0]?.stationId ?? null);
    }
  }, [hasActiveSearchOrFilter, filteredStations, selectedStationId, stations]);

  async function loadStations(): Promise<void> {
    const list = await fetchStations();
    setStations(list);
    if (!selectedStationId && list.length > 0) {
      setSelectedStationId(list[0]?.id ?? list[0]?.stationId ?? null);
    }
    setMessage(`تم تحميل ${list.length} محطة`);
  }

  async function refreshBackendDbStatus(): Promise<void> {
    try {
      const health = await fetchBackendHealth();
      const isConnected = Boolean(health.dependencies.db);
      const mappedState = mapDbStateLabel(health.dependencies.dbState);
      setDbConnected(isConnected);
      setDbStatusText(isConnected ? `متصل${mappedState ? ` (${mappedState})` : ""}` : `غير متصل${mappedState ? ` (${mappedState})` : ""}`);
      setDbCheckedAt(health.timestamp);
    } catch {
      setDbConnected(false);
      setDbStatusText("تعذر فحص الحالة");
      setDbCheckedAt(null);
    }
  }

  useEffect(() => {
    const storedToken = window.localStorage.getItem("fuelmap_token");
    if (storedToken) {
      setToken(storedToken);
      void fetchMe(storedToken)
        .then((user) => {
          setAuthUser(user);
        })
        .catch(() => {
          window.localStorage.removeItem("fuelmap_token");
          setToken(null);
          setAuthUser(null);
        });
    }

    void loadStations().catch((error: Error) => {
      setMessage(error.message);
    });
    void refreshBackendDbStatus();

    const events = createEventsConnection();
    const healthTimer = setInterval(() => {
      void refreshBackendDbStatus();
    }, 30000);

    events.addEventListener("station.updated", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as {
        stationId: string;
        fuelStatus: FuelStatus;
        dieselStatus?: DieselStatus;
        congestion: Congestion;
        confidence: number;
        at: string;
      };

      setStations((prev) =>
        prev.map((station) =>
          (station.id ?? station.stationId) === payload.stationId
            ? {
                ...station,
                fuelStatus: payload.fuelStatus,
                dieselStatus: payload.dieselStatus ?? station.dieselStatus ?? "unavailable",
                supportsDiesel:
                  payload.dieselStatus && payload.dieselStatus !== "unavailable"
                    ? true
                    : station.supportsDiesel,
                congestion: payload.congestion,
                confidence: payload.confidence,
                lastVerifiedAt: payload.at
              }
            : station
        )
      );
    });

    return () => {
      clearInterval(healthTimer);
      events.close();
    };
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) {
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGeoPosition({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
      },
      () => {
        // Ignore location error.
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000
      }
    );
  }, []);

  useEffect(() => {
    if (!selectedStation) {
      return;
    }

    const dieselAvailable =
      Boolean(selectedStation.supportsDiesel) ||
      selectedStation.dieselStatus === "available" ||
      selectedStation.dieselStatus === "low";

    setFuelStatus(selectedStation.fuelStatus);
    setSupportsDiesel(dieselAvailable);
    setDieselStatus(selectedStation.dieselStatus ?? (dieselAvailable ? "low" : "unavailable"));
    setCongestion(selectedStation.congestion);
  }, [selectedStation]);

  async function handleLogin(): Promise<void> {
    if (!loginPhone.trim()) {
      setMessage("أدخل رقم الهاتف أولاً");
      return;
    }
    if (loginPhone.trim().length < 8) {
      setMessage("رقم الهاتف يجب أن لا يقل عن 8 أرقام");
      return;
    }
    if (!loginPassword.trim()) {
      setMessage("أدخل كلمة المرور");
      return;
    }
    if (loginPassword.trim().length < 8) {
      setMessage("كلمة المرور يجب أن لا تقل عن 8 أحرف");
      return;
    }

    setBusy(true);
    setMessage("جاري تسجيل الدخول...");
    try {
      const result = await loginUser({
        phone: loginPhone,
        password: loginPassword
      });

      setToken(result.accessToken);
      setAuthUser(result.user);
      window.localStorage.setItem("fuelmap_token", result.accessToken);
      setShowAuthPanel(false);
      setMessage(`تم تسجيل الدخول: ${roleLabel(result.user.role)}`);
    } catch (error) {
      void refreshBackendDbStatus();
      setMessage(error instanceof Error ? error.message : "فشل تسجيل الدخول");
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister(): Promise<void> {
    if (!registerFullName.trim()) {
      setMessage("أدخل الاسم");
      return;
    }
    if (!registerPhone.trim()) {
      setMessage("أدخل رقم الهاتف");
      return;
    }
    if (!registerAddress.trim()) {
      setMessage("أدخل العنوان");
      return;
    }
    if (registerPassword.trim().length < 8) {
      setMessage("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
      return;
    }

    setBusy(true);
    setMessage("جاري إنشاء الحساب...");
    try {
      const result = await registerUser({
        fullName: registerFullName,
        phone: registerPhone,
        address: registerAddress,
        password: registerPassword,
        city: registerCity || "Tripoli"
      });

      setToken(result.accessToken);
      setAuthUser(result.user);
      window.localStorage.setItem("fuelmap_token", result.accessToken);
      setShowAuthPanel(false);
      setMessage(`تم إنشاء الحساب وتسجيل الدخول: ${roleLabel(result.user.role)}`);
    } catch (error) {
      void refreshBackendDbStatus();
      setMessage(error instanceof Error ? error.message : "تعذر إنشاء الحساب");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout(): Promise<void> {
    if (token) {
      try {
        await logoutUser(token);
      } catch {
        // Logout on client even if API logout fails.
      }
    }

    window.localStorage.removeItem("fuelmap_token");
    setToken(null);
    setAuthUser(null);
    setMessage("تم تسجيل الخروج");
  }

  async function ensureEditorToken(): Promise<string> {
    if (!token) {
      throw new Error("يجب تسجيل الدخول أولاً");
    }

    if (!canEdit) {
      throw new Error("ليس لديك صلاحية تعديل حالة المحطات");
    }

    return token;
  }

  async function handleOsmStationUpdateRequest(osmStation: OSMFuelStation): Promise<void> {
    setBusy(true);
    setMessage("جاري ربط محطة OSM بالنظام...");
    try {
      const accessToken = await ensureEditorToken();
      const savedStation = await ingestOsmStation(accessToken, {
        osmId: osmStation.id,
        name: osmStation.nameAr,
        lat: osmStation.lat,
        lng: osmStation.lng,
        hasDiesel: osmStation.hasDiesel
      });

      await loadStations();
      const linkedId = savedStation.id ?? savedStation.stationId ?? null;
      setSelectedStationId(linkedId);
      setGeoPosition({ lat: osmStation.lat, lng: osmStation.lng });
      setMessage("تم اختيار المحطة، يمكنك تعديل الحالة من لوحة الجانب.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر ربط محطة الوقود");
    } finally {
      setBusy(false);
    }
  }

  async function handleEnableDieselRequest(payload: {
    stationId?: string;
    osmStation?: OSMFuelStation;
  }): Promise<void> {
    setBusy(true);
    setMessage("جاري تفعيل توفر الديزل...");
    try {
      const accessToken = await ensureEditorToken();
      let stationId = payload.stationId ?? null;

      if (!stationId && payload.osmStation) {
        const saved = await ingestOsmStation(accessToken, {
          osmId: payload.osmStation.id,
          name: payload.osmStation.nameAr,
          lat: payload.osmStation.lat,
          lng: payload.osmStation.lng,
          hasDiesel: true
        });
        stationId = saved.id ?? saved.stationId ?? null;
      }

      if (!stationId) {
        throw new Error("تعذر تحديد المحطة");
      }

      await updateStationFuelTypes(accessToken, stationId, {
        supportsDiesel: true,
        dieselStatus: "low"
      });

      await loadStations();
      setSelectedStationId(stationId);
      setSupportsDiesel(true);
      setDieselStatus("low");
      setMessage("تم تفعيل الديزل للمحطة.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تعديل توفر الديزل");
    } finally {
      setBusy(false);
    }
  }

  async function handleNearby(): Promise<void> {
    setBusy(true);
    setMessage("جاري تحديد موقعك...");
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000
        })
      );

      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      setGeoPosition({ lat, lng });

      const nearby = await fetchNearbyStations(lat, lng);
      setStations(nearby);
      setSelectedStationId(nearby[0]?.id ?? nearby[0]?.stationId ?? null);
      setMessage(`تم العثور على ${nearby.length} محطة قريبة`);
    } catch {
      setMessage("تعذر الوصول للموقع الجغرافي");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSelectedStation(): Promise<void> {
    if (!selectedStation) {
      setMessage("اختر محطة أولاً");
      return;
    }

    setBusy(true);
    setMessage("جاري حفظ تعديل حالة المحطة...");
    try {
      const accessToken = await ensureEditorToken();
      const stationId = selectedStation.id ?? selectedStation.stationId;
      if (!stationId) {
        throw new Error("معرف المحطة غير متاح");
      }

      const normalizedDieselStatus: DieselStatus = supportsDiesel ? dieselStatus : "unavailable";

      await updateStationFuelTypes(accessToken, stationId, {
        fuelStatus,
        supportsDiesel,
        dieselStatus: normalizedDieselStatus,
        congestion
      });

      await loadStations();
      setSelectedStationId(stationId);
      setMessage("تم حفظ حالة المحطة");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر حفظ تعديل المحطة");
    } finally {
      setBusy(false);
    }
  }

  function openAuth(mode: "login" | "register"): void {
    setAuthMode(mode);
    setShowAuthPanel(true);
  }

  function resetFilters(): void {
    setFilterCity("all");
    setFilterFuelStatus("all");
    setFilterDiesel("all");
    setFilterCongestion("all");
  }

  return (
    <section className="space-y-4">
      <header className="rounded-2xl border border-black/10 bg-white/80 p-4 shadow-md backdrop-blur">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-brand-900">FuelMap Libya</h1>
              <p className="text-sm text-black/70">
                تسجيل دخول بصلاحيات: محررون لتعديل الحالة، وباقي المستخدمين للعرض والفلترة
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {authUser ? (
                <>
                  <div className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs">
                    {authUser.fullName || "مستخدم"} | {roleLabel(authUser.role)}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleLogout()}
                    className="inline-flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
                  >
                    <LogOut size={15} />
                    تسجيل الخروج
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => openAuth("login")}
                    className="inline-flex items-center gap-2 rounded-xl border border-brand-700 bg-white px-3 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-50"
                  >
                    <LogIn size={15} />
                    تسجيل الدخول
                  </button>
                  <button
                    type="button"
                    onClick={() => openAuth("register")}
                    className="inline-flex items-center gap-2 rounded-xl bg-brand-800 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                  >
                    <User size={15} />
                    إنشاء حساب
                  </button>
                </>
              )}

              <button
                onClick={() => void handleNearby()}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-xl border border-brand-700 px-4 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-50 disabled:opacity-70"
              >
                <Locate size={16} />
                أقرب المحطات
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto]">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-black/45" />
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="ابحث عن محطة أو مدينة..."
                className="w-full rounded-xl border border-black/15 bg-white px-10 py-2.5 text-sm shadow-sm"
              />
            </div>
            {!canEdit ? (
              <button
                type="button"
                onClick={() => setShowFilterPanel(true)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-700 bg-cyan-50 px-4 py-2.5 text-sm font-semibold text-cyan-900 hover:bg-cyan-100"
              >
                <Filter size={16} />
                فتح الفلترة
              </button>
            ) : null}
          </div>

          <div className="rounded-xl border border-black/10 bg-white/75 px-3 py-2 text-sm text-black/80">
            {message}
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-black/10 bg-white/75 px-3 py-2 text-xs">
            <span
              className={`rounded-full px-2 py-1 font-semibold ${
                dbConnected === true
                  ? "bg-emerald-100 text-emerald-800"
                  : dbConnected === false
                    ? "bg-red-100 text-red-800"
                    : "bg-black/10 text-black/70"
              }`}
            >
              حالة قاعدة البيانات: {dbStatusText}
            </span>
            <button
              type="button"
              onClick={() => void refreshBackendDbStatus()}
              className="rounded-lg border border-black/15 bg-white px-2 py-1 text-[11px] font-semibold text-black/75 hover:bg-black/[0.04]"
            >
              تحديث الحالة
            </button>
            {dbCheckedAt ? (
              <span className="text-[11px] text-black/55">آخر فحص: {formatHealthTime(dbCheckedAt)}</span>
            ) : null}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
        <ClientStationMap
          stations={mapStations}
          highlightedStationIds={highlightedStationIds}
          selectedStationId={selectedStationId}
          onSelect={setSelectedStationId}
          canEdit={Boolean(canEdit)}
          onRequestStationUpdate={(station) => void handleOsmStationUpdateRequest(station)}
          onRequestEnableDiesel={(payload) => void handleEnableDieselRequest(payload)}
          userPosition={geoPosition}
          followUser
          center={geoPosition ? [geoPosition.lat, geoPosition.lng] : [27.0, 17.0]}
        />

        <aside className="space-y-4 lg:max-h-[540px] lg:overflow-y-auto lg:pr-1">
          <div className="rounded-2xl border border-sky-200/80 bg-gradient-to-b from-white to-sky-50/70 p-4 shadow-md">
            <h2 className="mb-2 flex items-center gap-2 text-lg font-bold">
              <ShieldCheck size={18} />
              ملخص البحث
            </h2>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <StatusPill title="المطابقة للبحث" value={`${highlightedStationIds.length}`} />
              <StatusPill title="كل المحطات" value={`${stations.length}`} />
            </div>
            {!canEdit ? (
              <button
                type="button"
                onClick={() => setShowFilterPanel(true)}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-700 bg-white px-3 py-2 text-sm font-semibold text-cyan-900 hover:bg-cyan-50"
              >
                <Filter size={15} />
                فتح نافذة الفلترة
              </button>
            ) : null}
          </div>

          <div className="rounded-2xl border border-amber-200/80 bg-gradient-to-b from-white to-amber-50/70 p-4 shadow-md">
            <h3 className="mb-3 flex items-center gap-2 text-lg font-bold">
              <MapPin size={18} />
              بيانات المحطة المختارة
            </h3>
            {!selectedStation ? (
              <p className="text-sm text-black/70">اختر محطة من الخريطة.</p>
            ) : (
              <div className="space-y-2 text-sm">
                <div className="text-base font-semibold">{selectedStation.name}</div>
                <div className="text-black/70">{selectedStation.city}</div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <StatusPill title="البنزين" value={fuelLabel(selectedStation.fuelStatus)} />
                  <StatusPill title="الديزل" value={dieselLabel(selectedStation.dieselStatus ?? "unavailable")} />
                  <StatusPill title="الازدحام" value={congestionLabel(selectedStation.congestion)} />
                  <StatusPill title="الثقة" value={`${Math.round(selectedStation.confidence * 100)}%`} />
                </div>
                <div className="rounded-lg bg-black/5 p-2 text-xs text-black/70">
                  <div>آخر تحديث: {formatStationTime(selectedStation.lastVerifiedAt)}</div>
                  <div>
                    الموقع: {selectedStation.lat.toFixed(5)}, {selectedStation.lng.toFixed(5)}
                  </div>
                </div>
              </div>
            )}
          </div>

          {canEdit ? (
            <div className="rounded-2xl border border-emerald-200/80 bg-gradient-to-b from-white to-emerald-50/70 p-4 shadow-md">
              <h3 className="mb-3 flex items-center gap-2 text-lg font-bold">
                <SlidersHorizontal size={18} />
                تعديل حالة المحطة
              </h3>

              <div className="space-y-3 rounded-xl border border-black/10 bg-white/80 p-3">
                <div className="space-y-1">
                  <label className="block text-sm font-medium">المحطة</label>
                  <select
                    value={selectedStationId ?? ""}
                    onChange={(event) => setSelectedStationId(event.target.value)}
                    className="w-full rounded-lg border border-black/20 bg-white px-3 py-2 shadow-sm"
                  >
                    {stations.map((station) => {
                      const id = station.id ?? station.stationId ?? "";
                      return (
                        <option key={id} value={id}>
                          {station.name} - {station.city}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <label className="block text-sm font-medium">كمية البنزين</label>
                    <select
                      value={fuelStatus}
                      onChange={(event) => setFuelStatus(event.target.value as FuelStatus)}
                      className="w-full rounded-lg border border-black/20 bg-white px-3 py-2 shadow-sm"
                    >
                      {fuelOptions.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-sm font-medium">هل المحطة توفر ديزل؟</label>
                    <select
                      value={supportsDiesel ? "yes" : "no"}
                      onChange={(event) => {
                        const enabled = event.target.value === "yes";
                        setSupportsDiesel(enabled);
                        if (!enabled) {
                          setDieselStatus("unavailable");
                        } else if (dieselStatus === "unavailable") {
                          setDieselStatus("low");
                        }
                      }}
                      className="w-full rounded-lg border border-black/20 bg-white px-3 py-2 shadow-sm"
                    >
                      <option value="yes">نعم</option>
                      <option value="no">لا</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-sm font-medium">كمية الديزل</label>
                    <select
                      value={supportsDiesel ? dieselStatus : "unavailable"}
                      onChange={(event) => setDieselStatus(event.target.value as DieselStatus)}
                      disabled={!supportsDiesel}
                      className="w-full rounded-lg border border-black/20 bg-white px-3 py-2 shadow-sm disabled:cursor-not-allowed disabled:bg-black/5"
                    >
                      {dieselOptions.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-sm font-medium">الازدحام</label>
                    <select
                      value={congestion}
                      onChange={(event) => setCongestion(event.target.value as Congestion)}
                      className="w-full rounded-lg border border-black/20 bg-white px-3 py-2 shadow-sm"
                    >
                      {congestionOptions.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={busy || !selectedStation}
                  onClick={() => void handleSaveSelectedStation()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-800 px-4 py-2 font-semibold text-white hover:bg-brand-700 disabled:opacity-70"
                >
                  <Fuel size={16} />
                  حفظ حالة المحطة
                </button>
              </div>
            </div>
          ) : null}

        </aside>
      </div>

      {showAuthPanel ? (
        <div className="fixed inset-0 z-[1600] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-black/10 bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <ShieldCheck size={18} />
                {authMode === "login" ? "تسجيل الدخول" : "إنشاء حساب جديد"}
              </h2>
              <button
                type="button"
                onClick={() => setShowAuthPanel(false)}
                className="rounded-lg border border-black/15 p-1.5 text-black/70 hover:bg-black/5"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg bg-black/5 p-1">
              <button
                type="button"
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                  authMode === "login" ? "bg-white shadow-sm" : "text-black/70"
                }`}
                onClick={() => setAuthMode("login")}
              >
                تسجيل دخول
              </button>
              <button
                type="button"
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                  authMode === "register" ? "bg-white shadow-sm" : "text-black/70"
                }`}
                onClick={() => setAuthMode("register")}
              >
                إنشاء حساب
              </button>
            </div>

            {authMode === "login" ? (
              <div className="space-y-3 rounded-xl border border-black/10 bg-white/80 p-3">
                <label className="block text-sm font-medium">رقم الهاتف</label>
                <input
                  value={loginPhone}
                  onChange={(event) => setLoginPhone(event.target.value)}
                  placeholder="09xxxxxxxx أو +2189xxxxxxxx"
                  className="w-full rounded-lg border border-black/20 bg-white px-3 py-2 text-sm shadow-sm"
                />

                <label className="block text-sm font-medium">كلمة المرور</label>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                  placeholder="********"
                  className="w-full rounded-lg border border-black/20 bg-white px-3 py-2 text-sm shadow-sm"
                />

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleLogin()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-800 px-4 py-2 font-semibold text-white hover:bg-brand-700 disabled:opacity-70"
                >
                  <LogIn size={16} />
                  تسجيل الدخول
                </button>
              </div>
            ) : (
              <div className="space-y-3 rounded-xl border border-black/10 bg-white/80 p-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <label className="block text-sm font-medium">الاسم</label>
                    <input
                      value={registerFullName}
                      onChange={(event) => setRegisterFullName(event.target.value)}
                      className="w-full rounded-lg border border-black/20 bg-white px-3 py-2 text-sm shadow-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-sm font-medium">رقم الهاتف</label>
                    <input
                      value={registerPhone}
                      onChange={(event) => setRegisterPhone(event.target.value)}
                      placeholder="09xxxxxxxx أو +2189xxxxxxxx"
                      className="w-full rounded-lg border border-black/20 bg-white px-3 py-2 text-sm shadow-sm"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-sm font-medium">العنوان</label>
                  <input
                    value={registerAddress}
                    onChange={(event) => setRegisterAddress(event.target.value)}
                    placeholder="مثال: بنغازي - شارع دبي"
                    className="w-full rounded-lg border border-black/20 bg-white px-3 py-2 text-sm shadow-sm"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <label className="block text-sm font-medium">المدينة</label>
                    <select
                      value={registerCity}
                      onChange={(event) => setRegisterCity(event.target.value)}
                      className="w-full rounded-lg border border-black/20 bg-white px-3 py-2 text-sm shadow-sm"
                    >
                      {citySelectorOptions.map((city) => (
                        <option key={city.value} value={city.value}>
                          {city.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-sm font-medium">كلمة المرور</label>
                    <input
                      type="password"
                      value={registerPassword}
                      onChange={(event) => setRegisterPassword(event.target.value)}
                      placeholder="8 أحرف أو أكثر"
                      className="w-full rounded-lg border border-black/20 bg-white px-3 py-2 text-sm shadow-sm"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleRegister()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-800 px-4 py-2 font-semibold text-white hover:bg-brand-700 disabled:opacity-70"
                >
                  <LogIn size={16} />
                  إنشاء الحساب
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {showFilterPanel && !canEdit ? (
        <div className="fixed inset-0 z-[1550] flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-black/10 bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-bold">
                <Filter size={18} />
                نافذة فلترة المحطات
              </h3>
              <button
                type="button"
                onClick={() => setShowFilterPanel(false)}
                className="rounded-lg border border-black/15 p-1.5 text-black/70 hover:bg-black/5"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 rounded-xl border border-black/10 bg-white/80 p-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="block text-sm font-medium">المدينة</label>
                  <select
                    value={filterCity}
                    onChange={(event) => setFilterCity(event.target.value)}
                    className="w-full rounded-lg border border-black/20 bg-white px-3 py-2 shadow-sm"
                  >
                    <option value="all">الكل</option>
                    {availableCities.map((city) => (
                      <option key={city} value={city}>
                        {city}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-sm font-medium">حالة البنزين</label>
                  <select
                    value={filterFuelStatus}
                    onChange={(event) => setFilterFuelStatus(event.target.value as "all" | FuelStatus)}
                    className="w-full rounded-lg border border-black/20 bg-white px-3 py-2 shadow-sm"
                  >
                    <option value="all">الكل</option>
                    {fuelOptions.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-sm font-medium">توفر الديزل</label>
                  <select
                    value={filterDiesel}
                    onChange={(event) => setFilterDiesel(event.target.value as "all" | "yes" | "no")}
                    className="w-full rounded-lg border border-black/20 bg-white px-3 py-2 shadow-sm"
                  >
                    <option value="all">الكل</option>
                    <option value="yes">يوفر ديزل</option>
                    <option value="no">لا يوفر ديزل</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-sm font-medium">الازدحام</label>
                  <select
                    value={filterCongestion}
                    onChange={(event) => setFilterCongestion(event.target.value as "all" | Congestion)}
                    className="w-full rounded-lg border border-black/20 bg-white px-3 py-2 shadow-sm"
                  >
                    <option value="all">الكل</option>
                    {congestionOptions.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={resetFilters}
                className="rounded-xl border border-black/15 bg-white px-4 py-2 text-sm font-semibold hover:bg-black/5"
              >
                إعادة ضبط
              </button>
              <button
                type="button"
                onClick={() => setShowFilterPanel(false)}
                className="rounded-xl bg-brand-800 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
              >
                تطبيق وإغلاق
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function fuelLabel(value: FuelStatus): string {
  if (value === "available") return "متوفر";
  if (value === "low") return "كمية قليلة";
  if (value === "unavailable") return "غير متوفر";
  return "مغلقة";
}

function dieselLabel(value: DieselStatus): string {
  if (value === "available") return "متوفر";
  if (value === "low") return "كمية قليلة";
  return "غير متوفر";
}

function congestionLabel(value: Congestion): string {
  if (value === "none") return "لا يوجد";
  if (value === "medium") return "متوسط";
  return "شديد";
}

function roleLabel(role: AppRole): string {
  if (role === "admin") return "مدير النظام";
  if (role === "station_manager") return "مستخدم مخوّل بالتعديل";
  return "مستخدم عرض وفلترة";
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
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function mapDbStateLabel(value?: string): string {
  if (!value) {
    return "";
  }
  if (value === "connected") {
    return "متصلة";
  }
  if (value === "connecting") {
    return "جارٍ الاتصال";
  }
  if (value === "disconnecting") {
    return "جارٍ الفصل";
  }
  if (value === "disconnected") {
    return "مفصولة";
  }
  return value;
}

function formatHealthTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "غير متوفر";
  }

  return new Intl.DateTimeFormat("ar-LY", {
    timeStyle: "short"
  }).format(date);
}

function StatusPill({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white/80 px-2.5 py-2 shadow-sm">
      <div className="text-[11px] text-black/55">{title}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

