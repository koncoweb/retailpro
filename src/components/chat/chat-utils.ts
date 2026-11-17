/**
 * Small presentational helpers shared by the chat screens.
 *
 * Kept apart from `@/lib/chat.ts` on purpose: the data module must stay free of
 * display concerns (it is unit-tested and reused by mutations), while these are
 * only about how a timestamp or an initial reads to an Indonesian operator.
 */

/** Up-to-two initials for an avatar fallback ("Budi Santoso" -> "BS"). */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Clock time only, e.g. "14:05". */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" }).format(d);
}

/** A short, absolute stamp for the conversation-list preview line. */
export function formatListStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return formatClock(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Kemarin";
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" }).format(d);
}

/** Full calendar day label for a transcript divider ("Senin, 12 Mei 2025"). */
export function formatDayDivider(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Hari ini";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Kemarin";
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

/** Consecutive messages within this window collapse their name/avatar (ms). */
export const GROUP_WINDOW_MS = 5 * 60 * 1000;
