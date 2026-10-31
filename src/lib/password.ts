/**
 * The password rule an admin sets for a new employee.
 *
 * It lives here because both halves of the flow need it: the Employees dialog
 * (to explain the problem beside the field, in the language the screen speaks)
 * and `POST /api/admin/users` (which must refuse a weak password even when the
 * request does not come from that dialog). The API imports this module through
 * a relative path, so keep it free of browser and Node APIs.
 */

/** Matches Better Auth's own default `minPasswordLength`. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * `null` when the value is acceptable, otherwise the sentence to show under the
 * field. The value is trimmed first, because the API trims before hashing.
 */
export function passwordProblem(value: string): string | null {
  const password = value.trim();
  if (password.length === 0) return "Password wajib diisi";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password minimal ${MIN_PASSWORD_LENGTH} karakter`;
  }
  return null;
}
