import { describe, it, expect } from "vitest";
import { MIN_PASSWORD_LENGTH, passwordProblem } from "./password";

describe("passwordProblem", () => {
  it("asks for a password when the field is empty", () => {
    expect(passwordProblem("")).toBe("Password wajib diisi");
    // Whitespace is trimmed before measuring, so it counts as empty.
    expect(passwordProblem("   ")).toBe("Password wajib diisi");
  });

  it("rejects anything below the floor by exactly one character", () => {
    const short = "a".repeat(MIN_PASSWORD_LENGTH - 1);
    expect(passwordProblem(short)).toBe(`Password minimal ${MIN_PASSWORD_LENGTH} karakter`);
  });

  it("accepts a password that meets the floor", () => {
    expect(passwordProblem("a".repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });

  it("measures the trimmed value, matching what the API hashes", () => {
    // Six characters padded to ten still counts as six.
    expect(passwordProblem("  abcdef  ")).toBe(`Password minimal ${MIN_PASSWORD_LENGTH} karakter`);
  });
});
