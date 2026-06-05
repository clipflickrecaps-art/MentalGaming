import { initDataString } from "./telegram";

const API_BASE = "/api/store";

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const initData = initDataString();
  if (initData) headers.set("X-Telegram-Init-Data", initData);

  // Dev-mode fallback when running in plain browser preview outside Telegram.
  if (!initData && import.meta.env.DEV) {
    const devId = localStorage.getItem("dev-telegram-id");
    const devName = localStorage.getItem("dev-telegram-name");
    if (devId) {
      headers.set("X-Dev-Telegram-Id", devId);
      if (devName) headers.set("X-Dev-Telegram-Name", devName);
    }
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* noop */ }

  if (!res.ok) {
    const msg = (data && typeof data === "object" && "error" in (data as Record<string, unknown>))
      ? String((data as Record<string, unknown>)["error"])
      : `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, data);
  }
  return data as T;
}

export const api = {
  get:      <T>(p: string)                    => request<T>(p),
  post:     <T>(p: string, body: unknown)     => request<T>(p, { method: "POST",  body: JSON.stringify(body) }),
  patch:    <T>(p: string, body: unknown)     => request<T>(p, { method: "PATCH", body: JSON.stringify(body) }),
  postForm: <T>(p: string, form: FormData)    => request<T>(p, { method: "POST",  body: form }),
};

// ── Types ─────────────────────────────────────────────────────────────────
export interface Me {
  id: string;
  telegramId: number;
  username: string | null;
  firstName: string | null;
  balanceKS: number;
  balanceCoin: number;
  totalDeposited: number;
  tier: "Silver" | "Gold" | "Platinum";
  language: "en" | "mm";
  photoUrl: string | null;
  tierDiscountPct: number;
}

export interface CheckoutField {
  key: string;
  label: string;
  fieldType: "text" | "number" | "email" | "textarea";
  required: boolean;
  placeholder?: string;
  helpText?: string;
  sortOrder?: number;
}

export interface CheckoutDataEntry {
  key: string;
  label: string;
  value: string;
}

export interface Catalog {
  id: string;
  name: string;
  imageUrl: string | null;
  sortOrder: number;
  checkoutFields: CheckoutField[];
  productCount: number;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  region: string;
  productType: "DirectTopup" | "DigitalCode";
  price: number;
  effectivePrice: number;
  onSale: boolean;
  flashSaleEnd: string | null;
  inStock: boolean;
  imageUrl: string | null;
  description: string;
  catalogId: string | null;
  sortOrder: number;
  checkoutFields: CheckoutField[] | null;
}

export interface Category { name: string; count: number; }

export interface ShopResponse { products: Product[]; categories: Category[]; }
export interface CatalogsResponse { catalogs: Catalog[]; }

export type OrderStatus = "Pending" | "Processing" | "Success" | "Cancelled" | "Refunded";

export interface OrderSummary {
  id: string;
  shortId: string;
  productName: string;
  productImage: string | null;
  amount: number;
  status: OrderStatus;
  gameId: string | null;
  zoneId: string | null;
  checkoutData?: CheckoutDataEntry[];
  quantity?: number;
  timestamp: string;
}

export interface OrderDetail {
  id: string;
  shortId: string;
  product: Product | null;
  amount: number;
  originalAmount: number | null;
  tierDiscount: number;
  status: OrderStatus;
  gameId: string | null;
  zoneId: string | null;
  checkoutData?: CheckoutDataEntry[];
  quantity?: number;
  unitPrice?: number | null;
  catalogName?: string | null;
  timestamp: string;
  notes: string;
}

export interface WalletResponse {
  balanceKS: number;
  balanceCoin: number;
  tier: "Silver" | "Gold" | "Platinum";
  totalDeposited: number;
  history: {
    id: string;
    type: string;
    wallet: "KS" | "Coin";
    amount: number;
    status: string;
    paymentMethod: string | null;
    description: string | null;
    at: string | null;
  }[];
}

export interface PaymentMethod {
  id: string;
  label: string;
  accountName: string;
  accountNumber: string;
}
