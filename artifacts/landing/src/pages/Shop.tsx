import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Search, ArrowLeft } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Glass } from "@/components/Glass";
import { EmptyState, Skeleton } from "@/components/EmptyState";
import { api, type ShopResponse } from "@/lib/api";
import { ks, cn } from "@/lib/format";
import { haptic } from "@/lib/telegram";

const CATEGORY_ICONS: Record<string, string> = {
  "Mobile Legends": "🗡️",
  "PUBG Mobile": "🎯",
  "Free Fire": "🔥",
  "Genshin Impact": "🌟",
  "Valorant": "💥",
  "Steam": "🎮",
  "Google Play": "▶️",
  "App Store": "🍎",
  "Netflix": "🎬",
  "Spotify": "🎵",
  "PlayStation": "🕹️",
  "Xbox": "🎮",
};
function catIcon(name: string) {
  for (const [k, v] of Object.entries(CATEGORY_ICONS)) {
    if (name.toLowerCase().includes(k.toLowerCase())) return v;
  }
  return "🎮";
}

export default function ShopPage() {
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const allQ = useQuery({
    queryKey: ["shop-all"],
    queryFn: () => api.get<ShopResponse>("/products"),
    staleTime: 5 * 60 * 1000,
  });

  const catQ = useQuery({
    queryKey: ["shop", selectedCat, q],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (selectedCat) sp.set("category", selectedCat);
      if (q) sp.set("search", q);
      return api.get<ShopResponse>(`/products?${sp.toString()}`);
    },
    enabled: selectedCat !== null || q.length > 0,
  });

  const categories = allQ.data?.categories ?? [];

  if (selectedCat === null && q.length === 0) {
    return (
      <Layout title="Shop" showNav>
        <div className="space-y-4 pt-1">
          <Glass className="flex items-center gap-2 px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search games, packs…"
              className="bg-transparent outline-none flex-1 text-sm placeholder:text-muted-foreground"
              data-testid="input-search"
            />
          </Glass>

          {allQ.isLoading ? (
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
            </div>
          ) : categories.length === 0 ? (
            <EmptyState title="No categories yet" hint="Products will appear here." />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {categories.map((cat) => (
                <button
                  key={cat.name}
                  onClick={() => { haptic("selection"); setSelectedCat(cat.name); }}
                  className="pressable text-left"
                  data-testid={`cat-${cat.name}`}
                >
                  <Glass className="p-4 flex flex-col gap-2 h-full">
                    <div className="text-3xl">{catIcon(cat.name)}</div>
                    <div className="text-sm font-semibold leading-tight">{cat.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {cat.count} {cat.count === 1 ? "product" : "products"}
                    </div>
                  </Glass>
                </button>
              ))}
            </div>
          )}
        </div>
      </Layout>
    );
  }

  const products = catQ.data?.products ?? [];
  const title = selectedCat ?? "Search results";

  return (
    <Layout title={title} showNav>
      <div className="space-y-4 pt-1">
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setSelectedCat(null); setQ(""); }}
            className="pressable h-9 w-9 rounded-full glass border border-white/10 flex items-center justify-center"
            data-testid="btn-back-categories"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <Glass className="flex items-center gap-2 px-3 py-2 flex-1">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search in ${selectedCat ?? "all"}…`}
              className="bg-transparent outline-none flex-1 text-sm placeholder:text-muted-foreground"
              data-testid="input-search"
            />
          </Glass>
        </div>

        {catQ.isLoading ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44" />)}
          </div>
        ) : products.length === 0 ? (
          <EmptyState title="No products found" hint="Try a different search term." />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {products.map((p) => (
              <Link key={p.id} href={`/product/${p.id}`} data-testid={`product-${p.id}`}>
                <Glass className="pressable p-3 h-full flex flex-col">
                  <div className="aspect-square rounded-xl bg-white/5 mb-2 overflow-hidden flex items-center justify-center text-3xl">
                    {p.imageUrl
                      ? <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" />
                      : <span>🎮</span>}
                  </div>
                  <div className="text-xs font-medium line-clamp-2 min-h-[2rem]">{p.name}</div>
                  <div className="mt-auto pt-1 flex items-baseline gap-1">
                    <span className="text-sm font-bold">{ks(p.effectivePrice)}</span>
                    {p.onSale && (
                      <span className="text-[10px] line-through text-muted-foreground">
                        {ks(p.price)}
                      </span>
                    )}
                  </div>
                  {!p.inStock && (
                    <div className="text-[10px] text-rose-300 mt-0.5">Out of stock</div>
                  )}
                </Glass>
              </Link>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
