import { useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Glass } from "@/components/Glass";
import { api, ApiError } from "@/lib/api";
import { ks, coin, cn } from "@/lib/format";
import { haptic, getTg } from "@/lib/telegram";

interface SpinStatus {
  canFreeSpin: boolean;
  nextFreeSpinMs: number;
  coinBalance: number;
  spinCostCoins: number;
  prizePool: { id: string; label: string; type: string; value: number }[];
}
interface SpinResult {
  prize: { id: string; label: string; type: string; value: number };
  usedFreeSpin: boolean;
  newBalanceKS: number;
  newBalanceCoin: number;
}

const PRIZE_COLORS: Record<string, string> = {
  thanks: "text-muted-foreground",
  coins_50: "text-yellow-300",
  coins_200: "text-yellow-300",
  coins_500: "text-amber-400",
  ks_1000: "text-emerald-400",
  ks_5000: "text-emerald-300",
  free_spin: "text-primary",
};

function useCountdown(ms: number) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function SpinPage() {
  const qc = useQueryClient();
  const [result, setResult] = useState<SpinResult | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [wheelAngle, setWheelAngle] = useState(0);
  const spinRef = useRef(0);

  const statusQ = useQuery<SpinStatus>({
    queryKey: ["spin-status"],
    queryFn: () => api.get("/spin/status"),
    refetchInterval: 60000,
  });

  const spinMut = useMutation<SpinResult, ApiError, boolean>({
    mutationFn: (usePaid) =>
      api.post("/spin", { usePaid }),
    onMutate: () => {
      setSpinning(true);
      setResult(null);
      haptic("medium");
      const extra = 1440 + Math.floor(Math.random() * 720);
      spinRef.current += extra;
      setWheelAngle(spinRef.current);
    },
    onSuccess: (data) => {
      setTimeout(() => {
        setSpinning(false);
        setResult(data);
        haptic("success");
        qc.invalidateQueries({ queryKey: ["spin-status"] });
        qc.invalidateQueries({ queryKey: ["me"] });
      }, 2200);
    },
    onError: (e) => {
      setSpinning(false);
      const tg = getTg();
      if (tg) tg.showAlert(e.message); else alert(e.message);
    },
  });

  const status = statusQ.data;
  const pool = status?.prizePool ?? [];

  return (
    <Layout title="Spin Wheel" showBack showNav={false}>
      <div className="flex flex-col items-center gap-5 pt-2 pb-28">

        {/* Wheel */}
        <div className="relative w-64 h-64 flex items-center justify-center">
          <div
            className="w-full h-full rounded-full border-4 border-white/10 relative transition-transform"
            style={{
              transform: `rotate(${wheelAngle}deg)`,
              transitionDuration: spinning ? "2200ms" : "0ms",
              transitionTimingFunction: "cubic-bezier(0.17, 0.67, 0.3, 1)",
            }}
          >
            {pool.map((p, i) => {
              const angle = (360 / pool.length) * i;
              const rad = (angle - 90) * (Math.PI / 180);
              const r = 88;
              const x = 128 + r * Math.cos(rad);
              const y = 128 + r * Math.sin(rad);
              const segAngle = 360 / pool.length;
              return (
                <div
                  key={p.id}
                  className="absolute text-[10px] font-semibold text-center leading-tight"
                  style={{
                    left: `${x}px`,
                    top: `${y}px`,
                    transform: `translate(-50%, -50%) rotate(${angle}deg)`,
                    width: "52px",
                    opacity: spinning ? 0.4 : 1,
                  }}
                >
                  {p.label}
                </div>
              );
            })}

            {/* Segments overlay */}
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 256 256">
              {pool.map((_, i) => {
                const n = pool.length;
                const angle = (360 / n) * i;
                const nextAngle = (360 / n) * (i + 1);
                const r = 120;
                const toRad = (a: number) => (a - 90) * (Math.PI / 180);
                const x1 = 128 + r * Math.cos(toRad(angle));
                const y1 = 128 + r * Math.sin(toRad(angle));
                const x2 = 128 + r * Math.cos(toRad(nextAngle));
                const y2 = 128 + r * Math.sin(toRad(nextAngle));
                return (
                  <line
                    key={i}
                    x1="128" y1="128" x2={x1} y2={y1}
                    stroke="rgba(255,255,255,0.06)"
                    strokeWidth="1"
                  />
                );
              })}
              <circle cx="128" cy="128" r="120" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
            </svg>

            {/* Center hub */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-12 h-12 rounded-full glass-strong border border-white/20 flex items-center justify-center text-xl">
                🎰
              </div>
            </div>
          </div>

          {/* Pointer */}
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 text-2xl z-10 drop-shadow">
            ▼
          </div>
        </div>

        {/* Result banner */}
        {result && !spinning && (
          <Glass className="w-full p-4 text-center border border-white/10 animate-in fade-in slide-in-from-bottom-2">
            <div className={cn("text-2xl font-bold mb-1", PRIZE_COLORS[result.prize.id] ?? "text-foreground")}>
              {result.prize.label}
            </div>
            {result.prize.type !== "none" && result.prize.type !== "spin" && (
              <div className="text-sm text-muted-foreground">
                {result.prize.type === "ks" ? `+${ks(result.prize.value)}` : `+${coin(result.prize.value)}`} added to your wallet
              </div>
            )}
            {result.prize.type === "spin" && (
              <div className="text-sm text-primary">You got a bonus free spin!</div>
            )}
          </Glass>
        )}

        {/* Status + buttons */}
        {statusQ.isLoading ? (
          <div className="h-20 w-full glass rounded-2xl animate-pulse" />
        ) : status ? (
          <Glass className="w-full p-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Free spin</span>
              <span className={status.canFreeSpin ? "text-emerald-400 font-semibold" : "text-muted-foreground"}>
                {status.canFreeSpin ? "✅ Available!" : `⏳ ${useCountdown(status.nextFreeSpinMs)}`}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Paid spin</span>
              <span>{coin(status.spinCostCoins)} per spin · you have {coin(status.coinBalance)}</span>
            </div>

            <div className="flex gap-2 pt-1">
              {status.canFreeSpin && (
                <button
                  disabled={spinning}
                  onClick={() => spinMut.mutate(false)}
                  className="pressable flex-1 bg-primary text-white rounded-2xl py-3 font-semibold disabled:opacity-40"
                  data-testid="button-free-spin"
                >
                  {spinning ? "Spinning…" : "🆓 Free Spin!"}
                </button>
              )}
              <button
                disabled={spinning || status.coinBalance < status.spinCostCoins}
                onClick={() => spinMut.mutate(true)}
                className={cn(
                  "pressable rounded-2xl py-3 font-semibold disabled:opacity-40 text-sm",
                  status.canFreeSpin ? "glass flex-none px-4" : "flex-1 bg-primary text-white"
                )}
                data-testid="button-paid-spin"
              >
                {spinning ? "…" : `🪙 Paid Spin (${status.spinCostCoins} MC)`}
              </button>
            </div>
          </Glass>
        ) : null}

        {/* Prize table */}
        {pool.length > 0 && (
          <Glass className="w-full p-4">
            <div className="text-xs font-medium text-muted-foreground mb-3">Prize Pool</div>
            <div className="space-y-1.5">
              {pool.map((p) => (
                <div key={p.id} className="flex items-center justify-between text-sm">
                  <span>{p.label}</span>
                  {p.type !== "none" && p.type !== "spin" && (
                    <span className="text-xs text-muted-foreground">
                      {p.type === "ks" ? ks(p.value) : coin(p.value)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Glass>
        )}
      </div>
    </Layout>
  );
}
