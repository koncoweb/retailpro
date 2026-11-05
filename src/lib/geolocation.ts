/**
 * Browser geolocation for the attendance geofence.
 *
 * The SPA talks straight to Turso, so "where is the employee standing" can only
 * be answered by the device itself — the `navigator.geolocation` API, which the
 * attendance screen calls when the user presses "Ambil lokasi". A successful fix
 * is compared against the workplace point stored on the branch/warehouse; the
 * resulting distance decides whether the check-in is allowed (hard-block mode)
 * and is written to the row as an audit trail.
 *
 * Two facts the caller must handle, both surfaced as typed errors here rather
 * than as raw DOMException codes:
 *   * geolocation (and the camera) require a *secure context*. `http://localhost`
 *     and HTTPS qualify; a plain `http://<LAN-IP>` dev link served to a phone
 *     does NOT — the browser hides the API entirely. `assertSecureContext()`
 *     turns that into an actionable message instead of a silent undefined.
 *   * accuracy is a radius, not a point, and mobile GPS drifts. The caller
 *     compares against `geo_radius_m` and should treat a fix whose accuracy is
 *     larger than the location's own radius as unreliable.
 *
 * The pure geometry (`haversineMeters`, `withinRadius`) is isolated from the DOM
 * API so it is unit-testable without a browser.
 */

export interface GeoPoint {
  /** WGS84 decimal degrees. */
  lat: number;
  lng: number;
}

export interface GeoFix extends GeoPoint {
  /** Accuracy of the fix in metres (the geolocation `coords.accuracy`). */
  accuracy: number;
}

export type GeolocationErrorCode =
  | 'unsupported'
  | 'insecure-context'
  | 'permission-denied'
  | 'position-unavailable'
  | 'timeout'
  | 'unknown';

export class GeolocationError extends Error {
  readonly code: GeolocationErrorCode;

  constructor(code: GeolocationErrorCode, message: string) {
    super(message);
    this.name = 'GeolocationError';
    this.code = code;
  }
}

/**
 * Whether the current page is served in a context that exposes `geolocation` /
 * `getUserMedia`. `window.isSecureContext` is true on HTTPS and on localhost;
 * false on `http://192.168.x.x`, where the browser refuses to prompt.
 */
export function isSecureContext(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(window.isSecureContext);
}

/** Throws an actionable `insecure-context` error before the browser silently hides the API. */
function assertSecureContext() {
  if (!isSecureContext()) {
    throw new GeolocationError(
      'insecure-context',
      'Lokasi butuh HTTPS. Buka aplikasi lewat HTTPS (atau localhost), bukan alamat IP lokal.'
    );
  }
}

function getCurrentPosition(
  options?: PositionOptions
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 0,
      ...options,
    });
  });
}

function toCode(error: GeolocationPositionError): GeolocationErrorCode {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return 'permission-denied';
    case error.POSITION_UNAVAILABLE:
      return 'position-unavailable';
    case error.TIMEOUT:
      return 'timeout';
    default:
      return 'unknown';
  }
}

const CODE_MESSAGE: Record<GeolocationErrorCode, string> = {
  unsupported: 'Perangkat ini tidak mendukung geolokasi.',
  'insecure-context': 'Lokasi butuh HTTPS.',
  'permission-denied':
    'Izin lokasi ditolak. Aktifkan izin lokasi untuk aplikasi ini lalu coba lagi.',
  'position-unavailable': 'Lokasi tidak dapat ditentukan saat ini.',
  timeout: 'Waktu pengambilan lokasi habis. Coba lagi.',
  unknown: 'Gagal mengambil lokasi.',
};

/**
 * Reads one high-accuracy position. Rejects with a `GeolocationError` carrying
 * an Indonesian, user-facing message so the screen can show it directly.
 */
export async function getCurrentCoords(options?: PositionOptions): Promise<GeoFix> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new GeolocationError('unsupported', CODE_MESSAGE.unsupported);
  }
  assertSecureContext();
  try {
    const position = await getCurrentPosition(options);
    return {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy ?? 0,
    };
  } catch (error) {
    // A DOMException (from the secure-context or permission path) versus the
    // typed GeolocationError we already built.
    if (error instanceof GeolocationError) throw error;
    const positionError = error as GeolocationPositionError;
    const code = toCode(positionError);
    throw new GeolocationError(code, CODE_MESSAGE[code] ?? CODE_MESSAGE.unknown);
  }
}

const EARTH_RADIUS_M = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance in metres between two WGS84 points (Haversine). Good to
 * well under a metre at the few-kilometre scales a geofence cares about.
 */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True when `point` lies within `radiusM` metres of `center`. */
export function withinRadius(point: GeoPoint, center: GeoPoint, radiusM: number): boolean {
  return haversineMeters(point, center) <= radiusM;
}

/** Compact human distance for badges: "128 m" or "1,4 km". */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return '-';
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return `${km.toFixed(1).replace('.', ',')} km`;
}

/** Whether a workplace row has usable coordinates set. */
export function hasCoordinates(row: {
  latitude?: number | null;
  longitude?: number | null;
}): boolean {
  return (
    typeof row.latitude === 'number' &&
    typeof row.longitude === 'number' &&
    Number.isFinite(row.latitude) &&
    Number.isFinite(row.longitude)
  );
}
