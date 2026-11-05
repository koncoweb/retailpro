/**
 * Shared data access for the attendance geofence + face enrollment.
 *
 * The check-in screen, the owner enrollment screen and the back-office report
 * all need the same two reads — "which workplaces have coordinates" and "what
 * face vectors does this employee have" — plus the enrollment write. Keeping
 * them here means one SQL shape for the whole feature instead of three copies
 * that can drift.
 *
 * Every call goes through `@/lib/db`, i.e. straight to the tenant's Turso
 * database. `descriptors` is stored as a JSON array of 128-float arrays; the
 * (de)serialisation lives in `src/lib/face.ts`, this module only moves the
 * string to/from the column.
 */
import { query } from "@/lib/db";
import { decodeDescriptors, encodeDescriptors, FACE_MODEL_VERSION } from "@/lib/face";

/** A branch or warehouse that staff can check in at. */
export interface WorkplaceLocation {
  type: "branch" | "warehouse";
  id: string;
  name: string | null;
  latitude: number | null;
  longitude: number | null;
  geo_radius_m: number;
  require_geo: number;
  require_face: number;
}

/** A stored enrollment, ready to compare. */
export interface FaceEnrollment {
  employeeId: string;
  samples: Float32Array[];
  sampleCount: number;
  matchThreshold: number;
}

/** Stable identity for a location across the branch/warehouse union. */
export function locationKey(type: string, id: string): string {
  return `${type}:${id}`;
}

/**
 * Every active workplace that has coordinates set, as a single list. A location
 * without coordinates is intentionally excluded: it cannot host a geofence, so
 * offering it would only let a check-in fail the radius test against a null
 * point. The owner turns one into a check-in location by saving coordinates on
 * the branch/warehouse screen.
 */
export async function fetchWorkplaceLocations(): Promise<WorkplaceLocation[]> {
  const result = await query<Record<string, unknown>>(
    `
      SELECT 'branch' AS type, id, name, latitude, longitude,
             geo_radius_m, require_geo, require_face
      FROM branches
      WHERE status = 'active' AND latitude IS NOT NULL AND longitude IS NOT NULL
      UNION ALL
      SELECT 'warehouse' AS type, id, name, latitude, longitude,
             geo_radius_m, require_geo, require_face
      FROM warehouses
      WHERE status = 'active' AND latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY name
    `
  );
  return result.rows.map((r) => ({
    type: r.type === "warehouse" ? "warehouse" : "branch",
    id: String(r.id),
    name: r.name != null ? String(r.name) : null,
    latitude: r.latitude != null ? Number(r.latitude) : null,
    longitude: r.longitude != null ? Number(r.longitude) : null,
    geo_radius_m: Number(r.geo_radius_m ?? 150),
    require_geo: Number(r.require_geo ?? 1),
    require_face: Number(r.require_face ?? 1),
  }));
}

/** id/name map for every workplace, for labeling stored attendance rows. */
export async function fetchLocationNames(): Promise<Record<string, string>> {
  const result = await query<Record<string, unknown>>(
    `
      SELECT 'branch' AS type, id, name FROM branches
      UNION ALL
      SELECT 'warehouse' AS type, id, name FROM warehouses
    `
  );
  const map: Record<string, string> = {};
  for (const r of result.rows) {
    map[locationKey(String(r.type), String(r.id))] = r.name ? String(r.name) : "(tanpa nama)";
  }
  return map;
}

/**
 * Reads one employee's enrollment. Returns null when they have none, so the
 * check-in flow can tell "not enrolled yet" apart from "enrolled but no match".
 */
export async function fetchFaceEnrollment(
  employeeId: string
): Promise<FaceEnrollment | null> {
  const result = await query<Record<string, unknown>>(
    `SELECT employee_id, descriptors, sample_count, match_threshold, model_version
     FROM face_enrollments WHERE employee_id = $1`,
    [employeeId]
  );
  const row = result.rows[0];
  if (!row) return null;
  const samples = decodeDescriptors(row.descriptors == null ? null : String(row.descriptors));
  return {
    employeeId: String(row.employee_id),
    samples,
    sampleCount: Number(row.sample_count ?? samples.length),
    matchThreshold: Number(row.match_threshold ?? 0.5),
  };
}

/**
 * Stores (or replaces) an enrollment. Face data is per-employee and singular, so
 * this is an upsert on the primary key. Stale model vectors are overwritten
 * wholesale — a re-enroll always captures against the current model.
 */
export async function saveFaceEnrollment(
  employeeId: string,
  samples: Float32Array[],
  enrolledBy: string | null,
  matchThreshold = 0.5
): Promise<void> {
  const descriptors = encodeDescriptors(samples);
  await query(
    `
      INSERT INTO face_enrollments
        (employee_id, descriptors, sample_count, match_threshold, model_version, enrolled_by, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ON CONFLICT (employee_id) DO UPDATE SET
        descriptors = excluded.descriptors,
        sample_count = excluded.sample_count,
        match_threshold = excluded.match_threshold,
        model_version = excluded.model_version,
        enrolled_by = excluded.enrolled_by,
        updated_at = excluded.updated_at
    `,
    [employeeId, descriptors, samples.length, matchThreshold, FACE_MODEL_VERSION, enrolledBy]
  );
}

/** Removes an employee's stored face data. */
export async function deleteFaceEnrollment(employeeId: string): Promise<void> {
  await query(`DELETE FROM face_enrollments WHERE employee_id = $1`, [employeeId]);
}

/** Lightweight enrollment status per employee for the enrollment list. */
export interface EnrollmentStatus {
  employeeId: string;
  sampleCount: number;
  matchThreshold: number;
  updatedAt: string | null;
  modelVersion: string | null;
}

export async function fetchEnrollmentStatuses(): Promise<Record<string, EnrollmentStatus>> {
  const result = await query<Record<string, unknown>>(
    `SELECT employee_id, sample_count, match_threshold, updated_at, model_version FROM face_enrollments`
  );
  const map: Record<string, EnrollmentStatus> = {};
  for (const r of result.rows) {
    map[String(r.employee_id)] = {
      employeeId: String(r.employee_id),
      sampleCount: Number(r.sample_count ?? 0),
      matchThreshold: Number(r.match_threshold ?? 0.5),
      updatedAt: r.updated_at ? String(r.updated_at) : null,
      modelVersion: r.model_version ? String(r.model_version) : null,
    };
  }
  return map;
}
