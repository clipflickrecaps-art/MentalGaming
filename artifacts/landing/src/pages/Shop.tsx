import { useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Glass } from "@/components/Glass";
import { EmptyState, Skeleton } from "@/components/EmptyState";
import { api, type ShopResponse } from "@/lib/api";
import { ks, cn } from "@/lib/format";
import { haptic } from "@/lib/telegram";

export default function ShopPage() {
  const search = useSearch();
  const initialCat = useMemo(() => new URLSearchParams(search).get("category") || "All", [search]);
  const [cat, setCat] = useState(initialCat);
  const [q, setQ] = useState("");

  const shopQ = useQuery({
    queryKey: ["shop", cat, q],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (cat !== "All") sp.set("category", cat);
      if (q) sp.set("search", q);
      const qs = sp.toString();
      return api.get<ShopResponse>(`/products${qs ? `?${qs}` : ""}`);
    },
  });

  const cats = ["All", ...(shopQ.data?.categories.map((c) => c.name) ?? [])];

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

        <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
          {cats.map((c) => (
            <button
              key={c}
              onClick={() => { haptic("selection"); setCat(c); }}
              className={cn(
                "pressable shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium border",
                cat === c
                  ? "bg-primary text-white border-primary"
                  : "glass border-white/10 text-muted-foreground"
              )}
              data-testid={`chip-${c}`}
            >
              {c}
            </button>
          ))}
        </div>

        {shopQ.isLoading ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44" />)}
          </div>
        ) : !shopQ.data || shopQ.data.products.length === 0 ? (
          <EmptyState title="No products found" hint="Try a different category or search term." />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {shopQ.data.products.map((p) => (
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
