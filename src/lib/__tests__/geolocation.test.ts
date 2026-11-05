/**
 * Pure geodesy for the attendance geofence. No DOM: `haversineMeters`,
 * `withinRadius` and `formatDistance` are the parts the check-in screen trusts
 * to decide allow/deny, so they are pinned here against known references.
 */
import { describe, expect, it } from 'vitest';
import {
  formatDistance,
  GeolocationError,
  getCurrentCoords,
  haversineMeters,
  withinRadius,
} from '../geolocation';

// Earth radius used by the library (6 371 km) → one degree of latitude ≈ this.
const ONE_DEG_LAT_M = 111_194.9;

describe('haversineMeters', () => {
  it('is zero for the same point', () => {
    expect(haversineMeters({ lat: -6.9, lng: 107.6 }, { lat: -6.9, lng: 107.6 })).toBeCloseTo(0, 6);
  });

  it('matches the great-circle length of one degree of latitude', () => {
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(ONE_DEG_LAT_M, -1);
  });

  it('shrinks a longitude step as latitude grows (convergence of meridians)', () => {
    const atEquator = haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    const atLat60 = haversineMeters({ lat: 60, lng: 0 }, { lat: 60, lng: 1 });
    // 1° of longitude at 60° latitude ≈ half of its equatorial length.
    expect(atEquator).toBeCloseTo(ONE_DEG_LAT_M, -1);
    expect(atLat60).toBeCloseTo(atEquator * 0.5, -3);
  });

  it('is symmetric', () => {
    const a = { lat: -6.9147, lng: 107.6098 };
    const b = { lat: -7.7956, lng: 110.3695 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });
});

describe('withinRadius', () => {
  const center = { lat: -6.9147, lng: 107.6098 };
  // A point ~111 m north (0.001° of latitude).
  const point = { lat: center.lat + 0.001, lng: center.lng };
  const dist = haversineMeters(point, center);

  it('reports inside at exactly the radius and outside just below it', () => {
    expect(dist).toBeGreaterThan(100);
    expect(withinRadius(point, center, dist)).toBe(true);
    expect(withinRadius(point, center, dist - 1)).toBe(false);
  });

  it('treats the centre itself as within any non-negative radius', () => {
    expect(withinRadius(center, center, 0)).toBe(true);
  });
});

describe('formatDistance', () => {
  it('uses metres under a kilometre', () => {
    expect(formatDistance(128)).toBe('128 m');
  });

  it('switches to kilometres with an Indonesian comma', () => {
    expect(formatDistance(1400)).toBe('1,4 km');
  });

  it('renders a non-finite value as a dash', () => {
    expect(formatDistance(Number.NaN)).toBe('-');
    expect(formatDistance(Number.POSITIVE_INFINITY)).toBe('-');
  });
});

describe('getCurrentCoords', () => {
  // jsdom exposes neither `navigator.geolocation` nor a secure context, so the
  // browser API the geofence depends on is absent — the guard must surface that
  // as a typed, actionable error rather than hanging or returning undefined.
  it('rejects with a GeolocationError when geolocation is unavailable', async () => {
    await expect(getCurrentCoords()).rejects.toBeInstanceOf(GeolocationError);
  });
});
