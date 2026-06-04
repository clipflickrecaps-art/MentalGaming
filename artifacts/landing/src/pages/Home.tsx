import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Sparkles, Wallet, ArrowRight, Flame, ChevronRight, Gamepad2 } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Glass } from "@/components/Glass";
import { Skeleton } from "@/components/EmptyState";
import { api, type Me, type ShopResponse, type Product } from "@/lib/api";
import { ks, coin } from "@/lib/format";

export default function HomePage() {
  const meQ = useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/me") });
  const flashQ = useQuery({
    queryKey: ["flashsale"],
    queryFn: () => api.get<{ products: Product[] }>("/flashsale"),
  });
  const shopQ = useQuery({
    queryKey: ["shop"],
    queryFn: () => api.get<ShopResponse>("/products"),
  });

  return (
    <Layout showNav title="Mental Gaming">
      <div className="space-y-5 pt-1">
        {/* Wallet card */}
        <Glass variant="blue" className="p-5" data-testid="card-wallet">
          {meQ.isLoading ? (
            <Skeleton className="h-24" />
          ) : meQ.data ? (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wider text-white/70">
                    Hi, {meQ.data.firstName || "there"}
                  </div>
                  <div className="text-3xl font-bold mt-1" data-testid="text-balance-ks">
                    {ks(meQ.data.balanceKS)}
                  </div>
                  <div className="text-sm text-white/70 mt-0.5" data-testid="text-balance-coin">
                    + {coin(meQ.data.balanceCoin)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-white/60">Tier</div>
                  <div className="text-base font-semibold">{meQ.data.tier}</div>
                  {meQ.data.tierDiscountPct > 0 && (
                    <div className="text-xs text-white/70 mt-0.5">
                      −{meQ.data.tierDiscountPct}% all orders
                    </div>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-4">
                <Link
                  href="/topup"
                  className="pressable glass-strong rounded-xl py-3 text-center text-sm font-medium flex items-center justify-center gap-1.5"
                  data-testid="button-topup"
                >
                  <Wallet className="h-4 w-4" /> Top Up
                </Link>
                <Link
                  href="/shop"
                  className="pressable bg-white text-black rounded-xl py-3 text-center text-sm font-semibold flex items-center justify-center gap-1.5"
                  data-testid="button-shop-now"
                >
                  <Sparkles className="h-4 w-4" /> Shop Now
                </Link>
              </div>
            </>
          ) : (
            <div className="text-sm text-white/80">Connecting to Telegram…</div>
          )}
        </Glass>

        {/* Play & Earn shortcuts */}
        <section data-testid="section-play">
          <div className="flex items-center justify-between mb-2 px-1">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <Gamepad2 className="h-4 w-4 text-primary" /> Play & Earn
            </h2>
            <Link href="/play" className="text-xs text-primary flex items-center">
              All <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { href: "/spin",    emoji: "🎰", label: "Spin" },
              { href: "/checkin", emoji: "📅", label: "Check-In" },
              { href: "/referral",emoji: "🤝", label: "Referral" },
            ].map((item) => (
              <Link key={item.href} href={item.href}>
                <Glass className="pressable p-3 flex flex-col items-center gap-1 text-center">
                  <span className="text-2xl">{item.emoji}</span>
                  <span className="text-xs font-medium">{item.label}</span>
                </Glass>
              </Link>
            ))}
          </div>
        </section>

        {/* Flash sale */}
        {flashQ.data && flashQ.data.products.length > 0 && (
          <section data-testid="section-flashsale">
            <div className="flex items-center justify-between mb-2 px-1">
              <h2 className="text-sm font-semibold flex items-center gap-1.5">
                <Flame className="h-4 w-4 text-orange-400" /> Flash Sale
              </h2>
              <Link href="/shop" className="text-xs text-primary flex items-center">
                See all <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="flex gap-3 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1">
              {flashQ.data.products.map((p) => (
                <Link key={p.id} href={`/product/${p.id}`} className="shrink-0 w-40">
                  <ProductMiniCard p={p} />
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Categories */}
        {shopQ.data && shopQ.data.categories.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2 px-1">
              <h2 className="text-sm font-semibold">Categories</h2>
              <Link href="/shop" className="text-xs text-primary flex items-center">
                Browse <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {shopQ.data.categories.slice(0, 6).map((c) => (
                <Link
                  key={c.name}
                  href={`/shop?category=${encodeURIComponent(c.name)}`}
                  data-testid={`category-${c.name}`}
                >
                  <Glass className="pressable p-4 flex items-center justify-between">
                    <div>
                      <div className="font-medium text-sm">{c.name}</div>
                      <div className="text-xs text-muted-foreground">{c.count} items</div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </Glass>
                </Link>
              ))}
            </div>
          </section>
        )}

        {shopQ.isLoading && (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

function ProductMiniCard({ p }: { p: Product }) {
  return (
    <Glass className="pressable p-3" data-testid={`mini-product-${p.id}`}>
      <div className="aspect-square rounded-xl bg-white/5 mb-2 overflow-hidden flex items-center justify-center text-2xl">
        {p.imageUrl ? (
          <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" />
        ) : (
          <span>🎮</span>
        )}
      </div>
      <div className="text-xs font-medium truncate">{p.name}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-sm font-bold">{ks(p.effectivePrice)}</span>
        {p.onSale && (
          <span className="text-[10px] line-through text-muted-foreground">
            {ks(p.price)}
          </span>
        )}
      </div>
    </Glass>
  );
}
