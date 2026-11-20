import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Fulfillment, PaymentMethod } from "./shop";
import { SHOP } from "./shop";
import { orderCode } from "./format";

/**
 * One line of the basket. Prices and names are snapshotted at the moment the
 * shopper adds the goods, so a later price change in the back office cannot
 * silently rewrite an order that is already half-built.
 */
export type CartItem = {
  key: string;
  productId: string;
  /** Tenant slug of the seller — a slug is only unique inside one shop. */
  tenant: string;
  /** Seller name, snapshotted so the basket can name the shop that ships it. */
  seller?: string;
  slug: string;
  name: string;
  category: string | null;
  /** Which sellable SKU — null when the product has only one version. */
  variantId?: string | null;
  /** "Cokelat"; rendered beside the product name so the basket is unambiguous. */
  variantLabel?: string | null;
  unitName: string;
  /** Rendered form of the unit: "kg" or "karung · 25 kg". */
  unitLabel: string;
  qty: number;
  unitPrice: number;
};

export type OrderStatus =
  | "pending_payment"
  | "waiting_payment"
  | "confirmed"
  | "packing"
  | "shipped"
  | "done"
  | "cancelled"
  | "void";

export type Order = {
  id: string;
  createdAt: string;
  items: CartItem[];
  customer: {
    name: string;
    phone: string;
    address: string;
  };
  fulfillment: Fulfillment;
  date: string;
  slot: string;
  payment: PaymentMethod;
  /** For `transfer`: the specific bank id the shopper chose. */
  paymentBankId?: string;
  notes: string;
  status: OrderStatus;
  subtotal: number;
  deliveryFee: number;
  total: number;
  /** Server-side parent id from `POST /api/storefront/orders`; absent for local-only orders. */
  parentId?: string;
  /** Seller slugs this order was sent to, for status polling. */
  sellerSlugs?: string[];
  /** False while the order only exists on this device — the order page offers a retry. */
  synced: boolean;
  /** Outcome of the server-side WhatsApp invoice send; 'failed' nudges the shopper to CS. */
  whatsapp?: 'sent' | 'failed' | 'skipped';
};

export type ChatMsg = {
  id: string;
  from: "user" | "cs";
  text: string;
  at: string;
};

type Theme = "light" | "dark";

type State = {
  theme: Theme;
  cart: CartItem[];
  orders: Order[];
  chat: ChatMsg[];
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  addToCart: (item: Omit<CartItem, "key" | "qty"> & { qty?: number }) => void;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  clearCart: () => void;
  placeOrder: (input: {
    customer: Order["customer"];
    fulfillment: Fulfillment;
    date: string;
    slot: string;
    payment: PaymentMethod;
    paymentBankId?: string;
    notes: string;
    parentId?: string;
    sellerSlugs?: string[];
  }) => Order;
  pushChat: (from: ChatMsg["from"], text: string) => void;
};

/** Also read by the theme bootstrap in `routes/__root.tsx`. */
const STORAGE_KEY = "thalia-storefront";

/**
 * Basket line identity: seller + product + variant + pack.
 *
 * Two shops may sell goods under the same SKU, so the seller is part of the
 * key. A carton of Susu and a carton of Cokelat are different goods at
 * different prices, so they must never collapse into one line — nor may a kilo
 * and a sack of the same good.
 */
function lineKey(item: Pick<CartItem, "tenant" | "slug" | "variantId" | "unitName">) {
  return `${item.tenant ?? ""}-${item.slug}-${item.variantId ?? ""}-${item.unitName}`;
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export const useShop = create<State>()(
  persist(
    (set, get) => ({
      theme: "light",
      cart: [],
      orders: [],
      chat: [
        {
          id: "welcome",
          from: "cs",
          text: "Halo, CS Toko Bahan Kue di sini. Mau cari produk apa hari ini?",
          at: new Date().toISOString(),
        },
      ],
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      toggleTheme: () => {
        const theme = get().theme === "dark" ? "light" : "dark";
        applyTheme(theme);
        set({ theme });
      },
      addToCart: (item) => {
        const qty = item.qty ?? 1;
        const key = lineKey(item);
        const existing = get().cart.find((line) => line.key === key);
        if (existing) {
          set({
            cart: get().cart.map((line) =>
              line.key === key ? { ...line, qty: line.qty + qty } : line,
            ),
          });
          return;
        }
        set({
          cart: [...get().cart, { ...item, key, qty }],
        });
      },
      setQty: (key, qty) => {
        if (qty <= 0) {
          set({ cart: get().cart.filter((line) => line.key !== key) });
          return;
        }
        set({
          cart: get().cart.map((line) => (line.key === key ? { ...line, qty } : line)),
        });
      },
      remove: (key) => set({ cart: get().cart.filter((line) => line.key !== key) }),
      clearCart: () => set({ cart: [] }),
      placeOrder: (input) => {
        const items = get().cart;
        const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
        const deliveryFee = input.fulfillment === "delivery" ? SHOP.deliveryFee : 0;
        const order: Order = {
          id: orderCode(),
          createdAt: new Date().toISOString(),
          items,
          ...input,
          status: input.payment === "cash" ? "confirmed" : "pending_payment",
          subtotal,
          deliveryFee,
          total: subtotal + deliveryFee,
          // Until `submitOrderToServer` patches the parent id in, this order
          // only lives on the device — the order page shows a retry button.
          synced: false,
        };
        set({ orders: [order, ...get().orders], cart: [] });
        return order;
      },
      pushChat: (from, text) => {
        const msg: ChatMsg = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          from,
          text,
          at: new Date().toISOString(),
        };
        set({ chat: [...get().chat, msg] });
      },
    }),
    {
      name: STORAGE_KEY,
      version: 5,
      // v2 put the variant into the line key, v3 the seller, v4 aligned
      // OrderStatus with the server enum (waiting_payment → pending_payment),
      // v5 added `synced` (an order without a parentId never reached the server).
      // Baskets saved before that keep their goods, but their keys are rebuilt
      // so the same product does not appear twice once the shopper adds it again.
      migrate: (persisted, version) => {
        const state = persisted as { cart?: CartItem[]; orders?: Order[] };
        if (version < 3 && Array.isArray(state.cart)) {
          state.cart = state.cart.map((item) => ({
            ...item,
            tenant: item.tenant ?? "",
            key: lineKey({ ...item, tenant: item.tenant ?? "" }),
          }));
        }
        // v3→v4: rename legacy waiting_payment to pending_payment.
        if (version < 4 && Array.isArray(state.orders)) {
          state.orders = state.orders.map((order) => ({
            ...order,
            status: order.status === "waiting_payment" ? "pending_payment" : order.status,
          }));
        }
        // v4→v5: backfill `synced` from the presence of a server parent id.
        if (version < 5 && Array.isArray(state.orders)) {
          state.orders = state.orders.map((order) => ({
            ...order,
            synced: order.synced ?? Boolean(order.parentId),
          }));
        }
        return state as unknown as State;
      },
      partialize: (s) => ({
        theme: s.theme,
        cart: s.cart,
        orders: s.orders,
        chat: s.chat,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.theme) applyTheme(state.theme);
      },
    },
  ),
);

export function cartCount(cart: CartItem[]) {
  return cart.reduce((sum, item) => sum + item.qty, 0);
}

/* -------------------------------------------------------------------------- */
/* Server hand-off — one payload shape for checkout submit AND retry           */
/* -------------------------------------------------------------------------- */

/** Where the back-office API listens (same origin logic as `catalog.ts`). */
export const API_BASE = (
  (import.meta.env.VITE_CATALOG_API_URL as string | undefined) ?? "http://localhost:3000"
).replace(/\/+$/, "");

/**
 * POST a saved local order to the back office and patch the row with the
 * server's parent id. Throws with an Indonesian-safe message when the server
 * rejects or is unreachable — the caller keeps `synced: false` so the order
 * page can retry. Retrying is safe: each attempt creates its own server rows,
 * which is why the button only appears while NO parent id exists yet.
 */
export async function submitOrderToServer(order: Order): Promise<Order> {
  const response = await fetch(`${API_BASE}/api/storefront/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: order.items.map((item) => ({
        tenant: item.tenant,
        productId: item.productId,
        variantId: item.variantId ?? null,
        unitName: item.unitName,
        qty: item.qty,
      })),
      customer: {
        name: order.customer.name,
        phone: order.customer.phone,
        address: order.customer.address || null,
      },
      fulfillment: order.fulfillment,
      slot: order.slot,
      notes: order.notes || null,
      paymentChannel: order.payment,
      paymentBankId: order.payment === "transfer" ? (order.paymentBankId ?? null) : null,
    }),
  });
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(errorBody?.message ?? `HTTP ${response.status}`);
  }
  const result = (await response.json()) as {
    parentId: string;
    orders?: { whatsapp?: 'sent' | 'failed' | 'skipped' }[];
  };
  const synced: Order = {
    ...order,
    parentId: result.parentId,
    synced: true,
    // 'failed' on any seller row wins — the shopper should ping CS about it.
    whatsapp: result.orders?.some((r) => r.whatsapp === "failed")
      ? "failed"
      : (result.orders?.[0]?.whatsapp ?? order.whatsapp),
  };
  useShop.setState({
    orders: useShop.getState().orders.map((o) => (o.id === order.id ? synced : o)),
  });
  return synced;
}

export function cartTotal(cart: CartItem[]) {
  return cart.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
}

/**
 * Basket lines split by the shop that ships them.
 *
 * A marketplace basket is not one parcel: two sellers sit in it side by side.
 * Both the checkout summary and the order page print these groups so the
 * shopper can see which shop fulfils what, even though the platform charges a
 * single total. Lines saved before sellers existed fall back to the storefront's
 * own name instead of an empty heading.
 */
export function sellerGroups(cart: CartItem[]) {
  const groups = new Map<string, { seller: string; lines: CartItem[]; subtotal: number }>();
  for (const item of cart) {
    const seller = item.seller ?? SHOP.name;
    const group = groups.get(seller) ?? { seller, lines: [], subtotal: 0 };
    group.lines.push(item);
    group.subtotal += item.unitPrice * item.qty;
    groups.set(seller, group);
  }
  return [...groups.values()].sort((a, b) => a.seller.localeCompare(b.seller, "id"));
}
