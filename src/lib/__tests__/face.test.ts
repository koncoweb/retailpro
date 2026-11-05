/**
 * Pure face-vector math for attendance recognition. The TensorFlow-backed
 * capture path is deliberately not exercised here (it needs the vendored models
 * and a browser); these are the (de)serialisation and distance/match functions
 * that decide a check-in, testable without loading the network.
 */
import { describe, expect, it } from 'vitest';
import {
  bestMatch,
  decodeDescriptor,
  decodeDescriptors,
  DEFAULT_MATCH_THRESHOLD,
  descriptorDistance,
  encodeDescriptor,
  encodeDescriptors,
  FACE_MODEL_VERSION,
} from '../face';

const vec = (values: number[]) => Float32Array.from(values);

describe('descriptor (de)serialisation', () => {
  it('round-trips a single descriptor through a plain number array', () => {
    // Binary-exact fractions so the Float32 storage matches the input verbatim.
    const original = vec([0.5, -0.25, 0.125]);
    const encoded = encodeDescriptor(original);
    expect(encoded).toEqual([0.5, -0.25, 0.125]);
    const decoded = decodeDescriptor(encoded);
    expect(decoded).toBeInstanceOf(Float32Array);
    expect(Array.from(decoded)).toEqual([0.5, -0.25, 0.125]);
  });

  it('round-trips a whole enrollment (array of samples) as JSON', () => {
    const samples = [vec([1, 2, 3]), vec([4, 5, 6])];
    const raw = encodeDescriptors(samples);
    expect(typeof raw).toBe('string');
    const back = decodeDescriptors(raw);
    expect(back).toHaveLength(2);
    expect(Array.from(back[1])).toEqual([4, 5, 6]);
  });

  it('drops malformed entries and tolerates empty/garbage input', () => {
    expect(decodeDescriptors(null)).toEqual([]);
    expect(decodeDescriptors('not json')).toEqual([]);
    expect(decodeDescriptors('{}')).toEqual([]);
    // One valid sample and one containing a non-number: only the valid one is kept.
    const mixed = JSON.stringify([[0.5, 0.5], ['x', 1]]);
    const parsed = decodeDescriptors(mixed);
    expect(parsed).toHaveLength(1);
    expect(Array.from(parsed[0])).toEqual([0.5, 0.5]);
  });
});

describe('descriptorDistance', () => {
  it('is the euclidean (L2) norm of the difference', () => {
    expect(descriptorDistance(vec([0, 0]), vec([3, 4]))).toBeCloseTo(5, 6);
  });

  it('is zero for identical vectors', () => {
    expect(descriptorDistance(vec([1, 2, 3]), vec([1, 2, 3]))).toBeCloseTo(0, 6);
  });

  it('throws when the descriptors are of different length', () => {
    expect(() => descriptorDistance(vec([1, 2]), vec([1, 2, 3]))).toThrow(/length mismatch/);
  });
});

describe('bestMatch', () => {
  it('takes the closest stored sample and clears the threshold when it matches', () => {
    const stored = [vec([0, 0]), vec([10, 10])];
    const candidate = vec([0.1, 0.1]);
    const result = bestMatch(stored, candidate, 0.5);
    expect(result.matched).toBe(true);
    expect(result.score).toBeCloseTo(Math.hypot(0.1, 0.1), 5);
    expect(result.noFace).toBe(false);
  });

  it('reports unmatched when every sample is farther than the threshold', () => {
    const stored = [vec([0, 0])];
    const candidate = vec([3, 4]); // distance 5
    const result = bestMatch(stored, candidate, DEFAULT_MATCH_THRESHOLD);
    expect(result.matched).toBe(false);
    expect(result.score).toBeCloseTo(5, 6);
  });

  it('ignores stored samples whose length differs from the candidate', () => {
    const stored = [vec([1, 2, 3]), vec([0, 0])];
    // Only the 2-length sample is comparable; the 3-length one is skipped.
    const result = bestMatch(stored, vec([0, 0.1]), 0.5);
    expect(result.matched).toBe(true);
    expect(result.score).toBeLessThan(0.5);
  });

  it('returns an infinite score for an empty enrollment', () => {
    const result = bestMatch([], vec([1, 2, 3]));
    expect(result.matched).toBe(false);
    expect(result.score).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('model version', () => {
  it('is a stable, present string used to invalidate stale vectors', () => {
    expect(typeof FACE_MODEL_VERSION).toBe('string');
    expect(FACE_MODEL_VERSION.length).toBeGreaterThan(0);
  });
});
