import type {
  AuthUserProfile,
  Station,
  FuelStatus,
  DieselStatus,
  Congestion,
  MapBounds,
  OSMFuelStation,
  OSMGasLocation,
  SupportMessage,
  SupportThread
} from "./types";

const API_BASE = resolveApiBase();
const OVERPASS_ENDPOINTS = (
  process.env.NEXT_PUBLIC_OVERPASS_ENDPOINTS ??
  "https://overpass-api.de/api/interpreter,https://lz4.overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter"
)
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0);
const OVERPASS_CACHE_TTL_MS = 10 * 60 * 1000;
const OVERPASS_REQUEST_TIMEOUT_MS = 22_000;
const OVERPASS_DEFAULT_RETRY_AFTER_MS = 60_000;
const OVERPASS_TEMP_ERROR_COOLDOWN_MS = 20_000;
const OVERPASS_MAX_BBOX_AREA_DEG2 = 0.18;
const OVERPASS_MAX_ENDPOINT_TRIES = 1;

const overpassCache = new Map<string, { expiresAt: number; stations: OSMFuelStation[] }>();
const overpassGasCache = new Map<string, { expiresAt: number; items: OSMGasLocation[] }>();
let overpassCooldownUntil = 0;

type ApiErrorResponse = {
  error?: string;
  message?: string;
  details?: {
    fieldErrors?: Record<string, string[]>;
  } | null;
} | null;

function resolveApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    if (isLocalOrPrivateHost(hostname)) {
      if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
        return "http://localhost:4000";
      }
      return `http://${hostname}:4000`;
    }

    console.error(
      `NEXT_PUBLIC_API_BASE_URL is not configured for this deployment (hostname: ${hostname}).`
    );
  }

  return "";
}

function isLocalOrPrivateHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
    return true;
  }

  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4Match) {
    return false;
  }

  const octets = ipv4Match.slice(1).map((value) => Number(value));
  if (octets.some((value) => Number.isNaN(value) || value < 0 || value > 255)) {
    return false;
  }

  const [first, second] = octets;
  if (first === 10 || first === 127) {
    return true;
  }
  if (first === 192 && second === 168) {
    return true;
  }
  if (first === 172 && second >= 16 && second <= 31) {
    return true;
  }

  return false;
}

function normalizePhoneInput(raw: string): string {
  const latinized = raw
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));

  let value = latinized
    .trim()
    .replace(/[\s\-()]/g, "")
    .replace(/[\u200e\u200f]/g, "");

  if (value.startsWith("00")) {
    value = `+${value.slice(2)}`;
  }
  if (!value.startsWith("+") && value.startsWith("218")) {
    value = `+${value}`;
  }
  if (!value.startsWith("+") && value.startsWith("0")) {
    value = `+218${value.slice(1)}`;
  }
  if (value && !value.startsWith("+")) {
    value = `+${value}`;
  }

  return value;
}

function mapValidationErrorToArabic(error: ApiErrorResponse): string | null {
  const fieldErrors = error?.details?.fieldErrors;
  if (!fieldErrors) {
    return null;
  }

  const messages: string[] = [];

  if (fieldErrors.fullName) {
    messages.push("الاسم يجب أن يكون حرفين على الأقل");
  }
  if (fieldErrors.phone) {
    messages.push("رقم الهاتف مطلوب ويجب أن لا يقل عن 8 أرقام");
  }
  if (fieldErrors.address) {
    messages.push("العنوان مطلوب ويجب أن لا يقل عن 3 أحرف");
  }
  if (fieldErrors.password) {
    messages.push("كلمة المرور مطلوبة ويجب أن لا تقل عن 8 أحرف");
  }

  if (messages.length === 0) {
    return null;
  }

  return messages.join(" - ");
}

function mapApiErrorMessage(error: ApiErrorResponse, fallback: string): string {
  if (!error) {
    return fallback;
  }

  if (error.error === "ValidationError") {
    return mapValidationErrorToArabic(error) ?? "البيانات المدخلة غير صحيحة";
  }

  if (error.error === "DuplicateKey") {
    return "رقم الهاتف مستخدم بالفعل";
  }

  if (error.error === "DatabaseAuthorizationError") {
    return "تعذر الوصول إلى قاعدة البيانات. تحقق من إعدادات MongoDB على الخادم";
  }

  if (error.error === "InternalServerError") {
    return "حدث خطأ غير متوقع في الخادم. حاول مرة أخرى بعد قليل";
  }

  if (typeof error.message === "string" && error.message.trim().length > 0) {
    if (error.message.trim().toLowerCase() === "unexpected server error") {
      return "حدث خطأ غير متوقع في الخادم. حاول مرة أخرى بعد قليل";
    }
    return error.message;
  }

  return fallback;
}

export async function devLogin(role: "user" | "station_manager" | "admin" = "user") {
  const response = await fetch(`${API_BASE}/auth/dev-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role,
      name: "Web User",
      city: "Tripoli"
    })
  });

  if (!response.ok) {
    throw new Error("تعذر تسجيل الدخول التجريبي");
  }
  return (await response.json()) as { accessToken: string; user: { id: string; role: string } };
}

export async function loginUser(payload: {
  phone: string;
  password: string;
}): Promise<{ accessToken: string; user: AuthUserProfile }> {
  const normalizedPhone = normalizePhoneInput(payload.phone);
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      phone: normalizedPhone
    })
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as ApiErrorResponse;
    throw new Error(mapApiErrorMessage(error, "تعذر تسجيل الدخول"));
  }

  const data = (await response.json()) as {
    accessToken: string;
    user: AuthUserProfile;
  };
  return data;
}

export async function registerUser(payload: {
  fullName: string;
  phone: string;
  address: string;
  password: string;
  city?: string;
}): Promise<{ accessToken: string; user: AuthUserProfile }> {
  const normalizedPhone = normalizePhoneInput(payload.phone);
  const response = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      phone: normalizedPhone
    })
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as ApiErrorResponse;
    throw new Error(mapApiErrorMessage(error, "تعذر إنشاء الحساب"));
  }

  const data = (await response.json()) as {
    accessToken: string;
    user: AuthUserProfile;
  };
  return data;
}

export async function logoutUser(token: string): Promise<void> {
  await fetch(`${API_BASE}/auth/logout`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

export async function fetchMe(token: string): Promise<AuthUserProfile> {
  const response = await fetch(`${API_BASE}/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى");
  }

  const data = (await response.json()) as { user: AuthUserProfile };
  return data.user;
}

export async function fetchStations(): Promise<Station[]> {
  const response = await fetch(`${API_BASE}/stations`, {
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error("تعذر تحميل المحطات");
  }

  const data = (await response.json()) as { items: Station[] };
  return data.items.map((item) => ({
    ...item,
    id: item.id ?? item.stationId
  }));
}

export async function ingestOsmStation(
  token: string,
  payload: {
    osmId: string;
    name: string;
    lat: number;
    lng: number;
    hasDiesel?: boolean;
    city?: string;
  }
): Promise<Station> {
  const response = await fetch(`${API_BASE}/stations/ingest-osm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? "تعذر ربط محطة الوقود");
  }

  const station = (await response.json()) as Station;
  return {
    ...station,
    id: station.id ?? station.stationId
  };
}

export async function fetchNearbyStations(lat: number, lng: number): Promise<Station[]> {
  const response = await fetch(
    `${API_BASE}/stations/nearby?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&radiusKm=20`,
    {
      cache: "no-store"
    }
  );

  if (!response.ok) {
    throw new Error("تعذر تحميل المحطات القريبة");
  }

  const data = (await response.json()) as { items: Station[] };
  return data.items.map((item) => ({
    ...item,
    id: item.id ?? item.stationId
  }));
}

export async function updateStationFuelTypes(
  token: string,
  stationId: string,
  payload: {
    fuelStatus?: FuelStatus;
    supportsDiesel?: boolean;
    supportsGasoline?: boolean;
    dieselStatus?: DieselStatus;
    congestion?: Congestion;
  }
): Promise<Station> {
  const response = await fetch(`${API_BASE}/stations/${stationId}/fuel-types`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? "تعذر تحديث أنواع الوقود للمحطة");
  }

  const station = (await response.json()) as Station;
  return {
    ...station,
    id: station.id ?? station.stationId
  };
}

export async function submitReport(
  token: string,
  payload: {
    stationId: string;
    fuelStatus: FuelStatus;
    dieselStatus?: DieselStatus;
    congestion: Congestion;
    lat: number;
    lng: number;
    imageUrl?: string;
  }
) {
  const response = await fetch(`${API_BASE}/reports`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? "تعذر إرسال البلاغ");
  }

  return response.json();
}

export function createEventsConnection(): EventSource {
  return new EventSource(`${API_BASE}/events`);
}

export async function fetchFuelStationsFromOverpass(bounds: MapBounds): Promise<OSMFuelStation[]> {
  const now = Date.now();
  if (now < overpassCooldownUntil) {
    const secondsLeft = Math.ceil((overpassCooldownUntil - now) / 1000);
    throw new Error(`Overpass محدود مؤقتًا. أعد المحاولة خلال ${secondsLeft} ثانية.`);
  }

  const bboxArea = Math.abs((bounds.north - bounds.south) * (bounds.east - bounds.west));
  if (bboxArea > OVERPASS_MAX_BBOX_AREA_DEG2) {
    throw new Error("نطاق الخريطة واسع جدًا. قرّب أكثر لعرض محطات الوقود.");
  }

  const cacheKey = buildOverpassCacheKey(bounds);
  const cached = overpassCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.stations;
  }

  const query = `
[out:json][timeout:15];
(
  node["amenity"="fuel"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  way["amenity"="fuel"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
);
out center tags qt;
  `.trim();

  const endpoints = rotateEndpoints(OVERPASS_ENDPOINTS).slice(0, OVERPASS_MAX_ENDPOINT_TRIES);
  let lastError: Error | null = null;
  let sawRateLimit = false;
  let sawGatewayTimeout = false;

  for (const endpoint of endpoints) {
    try {
      const response = await fetchOverpass(endpoint, query);

      if (response.ok) {
        const data = (await response.json()) as {
          elements?: Array<{
            type: "node" | "way" | "relation";
            id: number;
            lat?: number;
            lon?: number;
            center?: { lat: number; lon: number };
            tags?: Record<string, string>;
          }>;
        };

        const elements = data.elements ?? [];
        const seen = new Set<string>();
        const stations: OSMFuelStation[] = [];

        for (const element of elements) {
          const lat = element.lat ?? element.center?.lat;
          const lng = element.lon ?? element.center?.lon;
          if (typeof lat !== "number" || typeof lng !== "number") {
            continue;
          }

          const id = `${element.type}/${element.id}`;
          if (seen.has(id)) {
            continue;
          }
          seen.add(id);

          const name = element.tags?.name?.trim() || "Fuel Station";
          const translatedName = translateStationNameToArabic(name);
          const hasDiesel = inferDieselFromTags(element.tags ?? {});

          stations.push({
            id,
            lat,
            lng,
            name,
            nameAr: translatedName,
            hasDiesel,
            fuelStatus: "low"
          });
        }

        overpassCache.set(cacheKey, {
          expiresAt: Date.now() + OVERPASS_CACHE_TTL_MS,
          stations
        });
        cleanupOverpassCache(Date.now());
        return stations;
      }

      if (response.status === 429) {
        sawRateLimit = true;
        const retryAfterMs =
          parseRetryAfterToMs(response.headers.get("retry-after")) ?? OVERPASS_DEFAULT_RETRY_AFTER_MS;
        overpassCooldownUntil = Math.max(overpassCooldownUntil, Date.now() + retryAfterMs);
        lastError = new Error("Overpass rate limited");
        break;
      }

      if (response.status === 502 || response.status === 503 || response.status === 504) {
        sawGatewayTimeout = true;
        lastError = new Error(`Overpass temporary error ${response.status}`);
        continue;
      }

      lastError = new Error(`Overpass error ${response.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Overpass request failed");
    }
  }

  if (sawRateLimit) {
    const secondsLeft = Math.ceil(Math.max(overpassCooldownUntil - Date.now(), 1000) / 1000);
    throw new Error(`Overpass مزدحم جدًا الآن. أعد المحاولة خلال ${secondsLeft} ثانية.`);
  }

  if (lastError?.message.includes("aborted")) {
    throw new Error("انتهت مهلة الاتصال مع Overpass. حاول مرة أخرى بعد قليل.");
  }

  if (sawGatewayTimeout) {
    overpassCooldownUntil = Math.max(overpassCooldownUntil, Date.now() + OVERPASS_TEMP_ERROR_COOLDOWN_MS);
    throw new Error("خادم Overpass بطيء حاليًا. حاول بعد قليل أو قرّب الخريطة أكثر.");
  }

  throw new Error("تعذر جلب محطات الوقود من Overpass الآن. حاول بعد قليل.");
}

export async function fetchGasLocationsFromOverpass(bounds: MapBounds): Promise<OSMGasLocation[]> {
  const now = Date.now();
  if (now < overpassCooldownUntil) {
    const secondsLeft = Math.ceil((overpassCooldownUntil - now) / 1000);
    throw new Error(`Overpass محدود مؤقتًا. أعد المحاولة خلال ${secondsLeft} ثانية.`);
  }

  const bboxArea = Math.abs((bounds.north - bounds.south) * (bounds.east - bounds.west));
  if (bboxArea > OVERPASS_MAX_BBOX_AREA_DEG2) {
    throw new Error("نطاق الخريطة واسع جدًا. قرّب أكثر لعرض موزعي الغاز.");
  }

  const cacheKey = `gas:${buildOverpassCacheKey(bounds)}`;
  const cached = overpassGasCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.items;
  }

  const query = `
[out:json][timeout:15];
(
  node["shop"="gas"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  way["shop"="gas"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  node["amenity"="fuel"]["fuel:lpg"~"yes|1|true",i](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  way["amenity"="fuel"]["fuel:lpg"~"yes|1|true",i](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  node["amenity"="fuel"]["fuel:gas"~"yes|1|true",i](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  way["amenity"="fuel"]["fuel:gas"~"yes|1|true",i](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
);
out center tags qt;
  `.trim();

  const endpoints = rotateEndpoints(OVERPASS_ENDPOINTS).slice(0, OVERPASS_MAX_ENDPOINT_TRIES);
  let sawRateLimit = false;
  let sawGatewayTimeout = false;
  let lastError: Error | null = null;

  for (const endpoint of endpoints) {
    try {
      const response = await fetchOverpass(endpoint, query);
      if (response.ok) {
        const data = (await response.json()) as {
          elements?: Array<{
            type: "node" | "way" | "relation";
            id: number;
            lat?: number;
            lon?: number;
            center?: { lat: number; lon: number };
            tags?: Record<string, string>;
          }>;
        };

        const items: OSMGasLocation[] = [];
        const seen = new Set<string>();
        for (const element of data.elements ?? []) {
          const lat = element.lat ?? element.center?.lat;
          const lng = element.lon ?? element.center?.lon;
          if (typeof lat !== "number" || typeof lng !== "number") {
            continue;
          }

          const id = `${element.type}/${element.id}`;
          if (seen.has(id)) {
            continue;
          }
          seen.add(id);

          const tags = element.tags ?? {};
          const hasLpg = inferLpgFromTags(tags);
          const sourceType = tags.shop === "gas" ? "distributor" : "station";
          const fallbackName = sourceType === "distributor" ? "Gas Distributor" : "Gas Station";
          const name = tags.name?.trim() || fallbackName;

          items.push({
            id,
            lat,
            lng,
            name,
            nameAr: translateGasNameToArabic(name),
            city: tags["addr:city"] ?? undefined,
            hasLpg,
            sourceType
          });
        }

        overpassGasCache.set(cacheKey, {
          expiresAt: Date.now() + OVERPASS_CACHE_TTL_MS,
          items
        });
        cleanupOverpassCache(Date.now());
        return items;
      }

      if (response.status === 429) {
        sawRateLimit = true;
        const retryAfterMs =
          parseRetryAfterToMs(response.headers.get("retry-after")) ?? OVERPASS_DEFAULT_RETRY_AFTER_MS;
        overpassCooldownUntil = Math.max(overpassCooldownUntil, Date.now() + retryAfterMs);
        break;
      }

      if (response.status === 502 || response.status === 503 || response.status === 504) {
        sawGatewayTimeout = true;
        lastError = new Error(`Overpass temporary error ${response.status}`);
        continue;
      }

      lastError = new Error(`Overpass error ${response.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Overpass request failed");
    }
  }

  if (sawRateLimit) {
    const secondsLeft = Math.ceil(Math.max(overpassCooldownUntil - Date.now(), 1000) / 1000);
    throw new Error(`Overpass مزدحم جدًا الآن. أعد المحاولة خلال ${secondsLeft} ثانية.`);
  }

  if (lastError?.message.includes("aborted")) {
    throw new Error("انتهت مهلة الاتصال مع Overpass. حاول مرة أخرى بعد قليل.");
  }

  if (sawGatewayTimeout) {
    overpassCooldownUntil = Math.max(overpassCooldownUntil, Date.now() + OVERPASS_TEMP_ERROR_COOLDOWN_MS);
    throw new Error("خادم Overpass بطيء حاليًا. حاول بعد قليل أو قرّب الخريطة أكثر.");
  }

  throw new Error("تعذر جلب مواقع الغاز من Overpass الآن. حاول بعد قليل.");
}

export async function fetchSupportThreads(
  token: string,
  options?: {
    admin?: boolean;
    read?: "all" | "read" | "unread";
    search?: string;
  }
): Promise<SupportThread[]> {
  const params = new URLSearchParams();
  if (options?.admin) {
    if (options.read) params.set("read", options.read);
    if (options.search?.trim()) params.set("q", options.search.trim());
    const response = await fetch(`${API_BASE}/support/admin/threads?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.message ?? "تعذر تحميل محادثات الدعم");
    }
    const data = (await response.json()) as { items: SupportThread[] };
    return data.items;
  }

  const response = await fetch(`${API_BASE}/support/threads/my`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? "تعذر تحميل محادثاتك");
  }
  const data = (await response.json()) as { items: SupportThread[] };
  return data.items;
}

export async function fetchSupportMessages(token: string, threadId: string): Promise<SupportMessage[]> {
  const response = await fetch(`${API_BASE}/support/threads/${encodeURIComponent(threadId)}/messages`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? "تعذر تحميل الرسائل");
  }
  const data = (await response.json()) as { items: SupportMessage[] };
  return data.items;
}

export async function createSupportThread(
  token: string,
  payload: { subject?: string; message: string }
): Promise<{ thread: SupportThread; message: SupportMessage }> {
  const response = await fetch(`${API_BASE}/support/threads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? "تعذر إنشاء المحادثة");
  }
  return (await response.json()) as { thread: SupportThread; message: SupportMessage };
}

export async function sendSupportMessage(token: string, threadId: string, body: string): Promise<SupportMessage> {
  const response = await fetch(`${API_BASE}/support/threads/${encodeURIComponent(threadId)}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ body })
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? "تعذر إرسال الرسالة");
  }
  const data = (await response.json()) as { message: SupportMessage };
  return data.message;
}

export async function markSupportThreadRead(token: string, threadId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/support/threads/${encodeURIComponent(threadId)}/read`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? "تعذر تحديث حالة القراءة");
  }
}

function buildOverpassCacheKey(bounds: MapBounds): string {
  // Quantize the map bounds so tiny pan changes reuse cached responses.
  const q = (value: number) => value.toFixed(1);
  return [q(bounds.south), q(bounds.west), q(bounds.north), q(bounds.east)].join("|");
}

function rotateEndpoints(endpoints: string[]): string[] {
  if (endpoints.length <= 1) {
    return endpoints;
  }

  const offset = Math.floor(Math.random() * endpoints.length);
  return [...endpoints.slice(offset), ...endpoints.slice(0, offset)];
}

async function fetchOverpass(endpoint: string, query: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OVERPASS_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
        Accept: "application/json"
      },
      body: query,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function parseRetryAfterToMs(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const numeric = Number(value.trim());
  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.max(1000, numeric * 1000);
  }

  const date = Date.parse(value);
  if (Number.isNaN(date)) {
    return null;
  }

  return Math.max(1000, date - Date.now());
}

function cleanupOverpassCache(now: number): void {
  for (const [key, value] of overpassCache.entries()) {
    if (value.expiresAt <= now) {
      overpassCache.delete(key);
    }
  }

  for (const [key, value] of overpassGasCache.entries()) {
    if (value.expiresAt <= now) {
      overpassGasCache.delete(key);
    }
  }
}

function inferDieselFromTags(tags: Record<string, string>): boolean {
  const dieselKeys = ["diesel", "fuel:diesel"];
  for (const key of dieselKeys) {
    const value = tags[key]?.toLowerCase();
    if (value === "yes" || value === "true" || value === "1") {
      return true;
    }
  }

  // If not explicitly provided in OSM tags, assume unknown/false by default.
  return false;
}

function inferLpgFromTags(tags: Record<string, string>): boolean {
  const keys = ["fuel:lpg", "lpg", "fuel:gas", "gas"];
  for (const key of keys) {
    const value = tags[key]?.toLowerCase();
    if (value === "yes" || value === "true" || value === "1") {
      return true;
    }
  }

  if (tags.shop === "gas") {
    return true;
  }

  return false;
}

function translateStationNameToArabic(name: string): string {
  if (!name) {
    return "محطة وقود";
  }

  if (/[\u0600-\u06FF]/.test(name)) {
    return name;
  }

  const value = name.toLowerCase();

  const directRules: Array<{ pattern: RegExp; text: string }> = [
    { pattern: /\bfuel\s*station\b/i, text: "محطة وقود" },
    { pattern: /\bpetrol\s*station\b/i, text: "محطة وقود" },
    { pattern: /\bgas\s*station\b/i, text: "محطة وقود" },
    { pattern: /\bfilling\s*station\b/i, text: "محطة وقود" }
  ];

  for (const rule of directRules) {
    if (rule.pattern.test(value)) {
      return rule.text;
    }
  }

  let translated = name
    .replace(/fuel/gi, "وقود")
    .replace(/petrol/gi, "وقود")
    .replace(/gas/gi, "وقود")
    .replace(/station/gi, "محطة")
    .replace(/service/gi, "خدمة")
    .replace(/services/gi, "خدمات")
    .trim();

  if (/[A-Za-z]/.test(translated)) {
    translated = "محطة وقود";
  }

  return translated || "محطة وقود";
}

function translateGasNameToArabic(name: string): string {
  if (!name) {
    return "موزع غاز";
  }
  if (/[\u0600-\u06FF]/.test(name)) {
    return name;
  }

  const value = name.toLowerCase();
  if (/\bgas\s*distributor\b/i.test(value) || /\blpg\b/i.test(value) || /\bgas\s*shop\b/i.test(value)) {
    return "موزع غاز";
  }
  if (/\bgas\s*station\b/i.test(value)) {
    return "محطة غاز";
  }

  const translated = name
    .replace(/gas/gi, "غاز")
    .replace(/station/gi, "محطة")
    .replace(/distributor/gi, "موزع")
    .replace(/shop/gi, "متجر")
    .replace(/lpg/gi, "غاز")
    .trim();

  if (/[A-Za-z]/.test(translated)) {
    return "موزع غاز";
  }

  return translated || "موزع غاز";
}


