import { useState } from "react";
import { useLocation, useRoute, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Coins, Wallet as WalletIcon, Check } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Glass } from "@/components/Glass";
import { Skeleton } from "@/components/EmptyState";
import { api, ApiError, type Product, type Me } from "@/lib/api";
import { ks, coin, cn } from "@/lib/format";
import { haptic } from "@/lib/telegram";

type PayMethod = "wallet" | "coin";

export default function OrderPage() {
  const [, params] = useRoute<{ id: string }>("/order/:id");
  const [, navigate] = useLocation();
  const id = params?.id || "";
  const qc = useQueryClient();

  const pQ = useQuery({
    queryKey: ["product", id],
    queryFn: () => api.get<Product>(`/products/${id}`),
    enabled: !!id,
  });
  const meQ = useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/me") });

  const [gameId, setGameId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [pay, setPay] = useState<PayMethod>("wallet");
  const [err, setErr] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ orderId: string; amount: number; status: string }>("/orders", {
        productId: id,
        gameId: gameId.trim() || undefined,
        zoneId: zoneId.trim() || undefined,
        paymentMethod: pay,
      }),
    onSuccess: (data) => {
      haptic("success");
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["wallet"] });
      navigate(`/orders/${data.orderId}?placed=1`);
    },
    onError: (e: unknown) => {
      haptic("error");
      setErr(e instanceof ApiError ? e.message : "Order failed");
    },
  });

  if (pQ.isLoading || meQ.isLoading) {
    return <Layout title="Checkout" showBack showNav={false}><Skeleton className="h-64" /></Layout>;
  }
  if (!pQ.data || !meQ.data) {
    return <Layout title="Checkout" showBack showNav={false}>Product unavailable</Layout>;
  }

  const tierPct = meQ.data.tierDiscountPct;
  const tierOff = Math.round((pQ.data.effectivePrice * tierPct) / 100);
  const total = Math.max(0, pQ.data.effectivePrice - tierOff);
  const needGameId = pQ.data.productType === "DirectTopup";
  const balance = pay === "coin" ? meQ.data.balanceCoin : meQ.data.balanceKS;
  const enough = balance >= total;
  const gameIdOk = !needGameId || gameId.trim().length > 0;

  return (
    <Layout title="Checkout" showBack showNav={false}>
      <div className="space-y-4 pb-32">
        <Glass className="p-4 flex items-center gap-3">
          <div className="w-16 h-16 rounded-xl bg-white/5 flex items-center justify-center text-2xl overflow-hidden">
            {pQ.data.imageUrl
              ? <img src={pQ.data.imageUrl} alt={pQ.data.name} className="w-full h-full object-cover" />
              : <span>🎮</span>}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted-foreground">{pQ.data.category}</div>
            <div className="font-semibold truncate">{pQ.data.name}</div>
            <div className="text-sm font-bold mt-0.5">{ks(pQ.data.effectivePrice)}</div>
          </div>
        </Glass>

        {needGameId && (
          <Glass className="p-4 space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Game ID</label>
              <input
                value={gameId}
                onChange={(e) => setGameId(e.target.value)}
                placeholder="Your in-game ID"
                className="w-full mt-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 outline-none focus:border-primary"
                data-testid="input-gameid"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Server / Zone (optional)</label>
              <input
                value={zoneId}
                onChange={(e) => setZoneId(e.target.value)}
                placeholder="e.g. 2001"
                className="w-full mt-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 outline-none focus:border-primary"
                data-testid="input-zoneid"
              />
            </div>
          </Glass>
        )}

        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2 px-1">Payment</div>
          <div className="grid grid-cols-2 gap-3">
            <PaymentOption
              icon={<WalletIcon className="h-5 w-5" />}
              label="Wallet"
              value={ks(meQ.data.balanceKS)}
              active={pay === "wallet"}
              onClick={() => { haptic("selection"); setPay("wallet"); }}
              testId="pay-wallet"
            />
            <PaymentOption
              icon={<Coins className="h-5 w-5" />}
              label="Mental Coins"
              value={coin(meQ.data.balanceCoin)}
              active={pay === "coin"}
              onClick={() => { haptic("selection"); setPay("coin"); }}
              testId="pay-coin"
            />
          </div>
          {!enough && (
            <div className="mt-2 text-xs text-rose-300 flex items-center justify-between">
              <span>Not enough balance.</span>
              <Link href="/topup" className="text-primary font-medium">Top up →</Link>
            </div>
          )}
        </div>

        <Glass className="p-4 space-y-1.5 text-sm">
          <Row label="Price">{ks(pQ.data.effectivePrice)}</Row>
          {tierOff > 0 && (
            <Row label={`${meQ.data.tier} tier (−${tierPct}%)`} className="text-emerald-300">
              − {ks(tierOff)}
            </Row>
          )}
          <div className="border-t border-white/10 my-2" />
          <Row label="Total" bold>{pay === "coin" ? coin(total) : ks(total)}</Row>
        </Glass>

        {err && (
          <div className="text-sm text-rose-300 text-center">{err}</div>
        )}

        <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 bg-gradient-to-t from-background to-transparent">
          <button
            disabled={!gameIdOk || !enough || mutation.isPending}
            onClick={() => { setErr(null); mutation.mutate(); }}
            className="pressable w-full bg-primary text-white rounded-2xl py-4 font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
            data-testid="button-confirm"
          >
            {mutation.isPending
              ? "Placing order…"
              : <><Check className="h-5 w-5" /> Confirm & Pay {pay === "coin" ? coin(total) : ks(total)}</>}
          </button>
        </div>
      </div>
    </Layout>
  );
}

function Row({ label, children, bold, className }: { label: string; children: React.ReactNode; bold?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between", className, bold && "font-semibold text-base")}>
      <span className={bold ? "" : "text-muted-foreground"}>{label}</span>
      <span>{children}</span>
    </div>
  );
}

function PaymentOption({ icon, label, value, active, onClick, testId }: {
  icon: React.ReactNode; label: string; value: string; active: boolean; onClick: () => void; testId: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "pressable text-left rounded-2xl p-3.5 border transition-colors",
        active ? "glass-blue border-primary/50" : "glass border-white/10"
      )}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="text-xs text-muted-foreground mt-1.5">{value}</div>
    </button>
  );
}
