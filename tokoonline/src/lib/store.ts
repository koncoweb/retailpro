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
  slug: string;
  name: string;
  category: string | null;
  unitName: string;
  /** Rendered form of the unit: "kg" or "karung · 25 kg". */
  unitLabel: string;
  qty: number;
  unitPrice: number;
};

export type OrderStatus = "waiting_payment" | "confirmed" | "packing" | "shipped" | "done";

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
  notes: string;
  status: OrderStatus;
  subtotal: number;
  deliveryFee: number;
  total: number;
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
    notes: string;
  }) => Order;
  pushChat: (from: ChatMsg["from"], text: string) => void;
};

/** Also read by the theme bootstrap in `routes/__root.tsx`. */
const STORAGE_KEY = "thalia-storefront";

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
          text: "Halo, Thalia Toko Bahan Kue di sini. Mau cari bahan apa hari ini?",
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
        const key = `${item.slug}-${item.unitName}`;
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
          status: input.payment === "cash" ? "confirmed" : "waiting_payment",
          subtotal,
          deliveryFee,
          total: subtotal + deliveryFee,
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

export function cartTotal(cart: CartItem[]) {
  return cart.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
}
