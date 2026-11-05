/**
 * Face recognition for attendance, running fully in the browser.
 *
 * The engine is `@vladmandic/face-api` (a maintained, ESM/Vite-friendly fork of
 * face-api.js) backed by TensorFlow.js and the three model bundles vendored in
 * `public/models` (tiny face detector → 68-point landmarks → 128-D recognition
 * encoder). Nothing is uploaded anywhere: the camera frame is processed on the
 * device and only the resulting **128-float descriptor** is persisted, in the
 * tenant's `face_enrollments` table. The raw image never leaves the tab.
 *
 * The library is imported *dynamically* (inside `loadFaceModels`) so that the
 * pure helpers below — descriptor (de)serialisation and the distance/match math —
 * are unit-testable in the jsdom vitest environment without loading TensorFlow,
 * and so the ~7 MB of weights are pulled only on the screens that need them.
 *
 * Matching uses the L2 (euclidean) distance between face vectors: face-api.js
 * treats a distance below ~0.5 as the same person, so `bestMatch` reports the
 * closest stored sample and whether it clears the enrollment's threshold. A
 * photo-of-a-photo can, in principle, defeat this — there is no hardware
 * liveness in face-api.js — so enrollment captures several angled samples and
 * the owner reviews the recorded score/flag. That caveat is documented, not
 * hidden.
 */

/** Bumped if the recognition model is swapped, invalidating stored vectors. */
export const FACE_MODEL_VERSION = 'face-recognition-v1';

/** Served statically from `public/models` (see package build). */
const MODEL_URL = `${import.meta.env.BASE_URL ?? '/'}models`.replace(/\/{2,}/g, '/');

/** Default "same person" cutoff for the 128-D euclidean distance. */
export const DEFAULT_MATCH_THRESHOLD = 0.5;

export type FaceSource =
  | HTMLVideoElement
  | HTMLCanvasElement
  | HTMLImageElement;

export interface FaceMatchResult {
  /** Smallest distance found between the candidate and any stored sample. */
  score: number;
  /** True when `score` clears the threshold (treated as the same face). */
  matched: boolean;
  /** True when there was no usable candidate face to compare. */
  noFace: boolean;
}

let loadPromise: Promise<void> | null = null;

/**
 * Loads the three networks once per session. Safe to await from any screen;
 * concurrent callers share the same promise.
 */
export async function loadFaceModels(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      const faceapi = await import('@vladmandic/face-api');
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
    })().catch((error) => {
      // A failed load must not poison the singleton; allow a later retry.
      loadPromise = null;
      throw error;
    });
  }
  return loadPromise;
}

/** True once the model weights have been fetched and are resident. */
export function areFaceModelsLoaded(): boolean {
  return loadPromise !== null;
}

/**
 * Detects the first face in `source` using the tiny detector (the only detector
 * whose weights we vendor) and returns its descriptor plus the box in
 * source-pixel space, or null when no face clears `minConfidence`.
 */
async function detectOne(source: FaceSource, minConfidence: number): Promise<{
  descriptor: Float32Array;
  box: { x: number; y: number; width: number; height: number };
} | null> {
  await loadFaceModels();
  const faceapi = await import('@vladmandic/face-api');
  // TinyFaceDetectorOptions is what routes the chain through the tiny detector;
  // a plain object here would silently select the SSD MobileNet we do NOT ship.
  const detection = await faceapi
    .detectSingleFace(
      source,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: minConfidence })
    )
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!detection) return null;
  const { x, y, width, height } = detection.detection.box;
  return {
    descriptor: Float32Array.from(detection.descriptor),
    box: { x, y, width, height },
  };
}

/**
 * Detects the first face in `source` and returns its 128-float descriptor, or
 * null when no face is present / confident enough. `minConfidence` guards
 * enrollment against a half-visible face producing a junk vector.
 */
export async function captureDescriptor(
  source: FaceSource,
  options?: { minConfidence?: number }
): Promise<Float32Array | null> {
  const found = await detectOne(source, options?.minConfidence ?? 0.4);
  return found ? found.descriptor : null;
}

/**
 * Live per-frame face box for the camera preview, in source-pixel space (the
 * caller scales it to the element). Also hands back the descriptor so a capture
 * can reuse the same frame without a second detection pass.
 */
export async function detectFaceWithDescriptor(
  source: FaceSource,
  options?: { minConfidence?: number }
): Promise<{
  box: { x: number; y: number; width: number; height: number };
  descriptor: Float32Array;
} | null> {
  return detectOne(source, options?.minConfidence ?? 0.4);
}

/* --------------------------------------------------------------------------- *
 * Pure (de)serialisation + matching. No TensorFlow, no DOM: safe in jsdom and
 * cheap to unit-test. Descriptors are stored as JSON arrays of numbers.
 * --------------------------------------------------------------------------- */

/** Float32 descriptor → plain number[] for JSON persistence. */
export function encodeDescriptor(descriptor: Float32Array): number[] {
  return Array.from(descriptor);
}

/** number[] → Float32 descriptor for comparison. */
export function decodeDescriptor(values: number[]): Float32Array {
  return Float32Array.from(values);
}

/** Serialises every sample of an enrollment to one JSON string. */
export function encodeDescriptors(descriptors: Float32Array[]): string {
  return JSON.stringify(descriptors.map((d) => Array.from(d)));
}

/** Parses the stored JSON back into descriptors, dropping malformed entries. */
export function decodeDescriptors(raw: string | null | undefined): Float32Array[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: Float32Array[] = [];
  for (const entry of parsed) {
    if (Array.isArray(entry) && entry.every((n) => typeof n === 'number')) {
      out.push(Float32Array.from(entry as number[]));
    }
  }
  return out;
}

/** Euclidean (L2) distance between two equal-length descriptors. */
export function descriptorDistance(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`descriptor length mismatch: ${a.length} vs ${b.length}`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Compares `candidate` against every stored sample and returns the closest
 * distance plus whether it clears `threshold`. A candidate with no stored
 * samples (or an empty enrollment) is reported as unmatched.
 */
export function bestMatch(
  stored: Float32Array[],
  candidate: Float32Array,
  threshold: number = DEFAULT_MATCH_THRESHOLD
): FaceMatchResult {
  if (stored.length === 0) {
    return { score: Number.POSITIVE_INFINITY, matched: false, noFace: false };
  }
  let best = Number.POSITIVE_INFINITY;
  for (const sample of stored) {
    if (sample.length !== candidate.length) continue;
    const d = descriptorDistance(sample, candidate);
    if (d < best) best = d;
  }
  if (!Number.isFinite(best)) {
    return { score: Number.POSITIVE_INFINITY, matched: false, noFace: false };
  }
  return { score: best, matched: best <= threshold, noFace: false };
}
