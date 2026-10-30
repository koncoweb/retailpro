const idr = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export function formatIDR(n: number) {
  return idr.format(n).replace("IDR", "Rp").trim();
}

export function formatDateID(iso: string) {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function todayPlus(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** `THL-…` — the prefix the back office can recognise as an online order. */
export function orderCode() {
  const n = Math.floor(1000 + Math.random() * 9000);
  const t = Date.now().toString(36).slice(-4).toUpperCase();
  return `THL-${t}${n.toString().slice(0, 2)}`;
}
