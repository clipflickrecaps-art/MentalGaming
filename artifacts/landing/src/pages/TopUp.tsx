import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Check } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Glass } from "@/components/Glass";
import { Skeleton } from "@/components/EmptyState";
import { api, ApiError, type PaymentMethod } from "@/lib/api";
import { ks, cn } from "@/lib/format";
import { haptic, getTg } from "@/lib/telegram";

const QUICK = [5000, 10000, 25000, 50000, 100000, 200000];
const METHODS = [
  { id: "KPay",    label: "KBZ Pay" },
  { id: "WavePay", label: "Wave Pay" },
  { id: "AYAPay",  label: "AYA Pay" },
  { id: "CBPay",   label: "CB Pay" },
] as const;

export default function TopUpPage() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [amount, setAmount] = useState<number>(10000);
  const [method, setMethod] = useState<typeof METHODS[number]["id"]>("KPay");
  const [reference, setReference] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const pmQ = useQuery({
    queryKey: ["payment-methods"],
    queryFn: () => api.get<{ methods: PaymentMethod[] }>("/payment-methods"),
  });

  const mut = useMutation({
    mutationFn: () =>
      api.post<{ requestId: string; message: string }>("/topups", {
        amount, paymentMethod: method, reference,
      }),
    onSuccess: (data) => {
      haptic("success");
      qc.invalidateQueries({ queryKey: ["wallet"] });
      const tg = getTg();
      if (tg) tg.showAlert(data.message, () => navigate("/wallet"));
      else { alert(data.message); navigate("/wallet"); }
    },
    onError: (e: unknown) => {
      haptic("error");
      const tg = getTg();
      const msg = e instanceof ApiError ? e.message : "Top-up failed";
      if (tg) tg.showAlert(msg); else alert(msg);
    },
  });

  function copyText(t: string, id: string) {
    haptic("light");
    navigator.clipboard?.writeText(t).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  // Filter payment methods to currently selected gateway label if matched
  const matched = pmQ.data?.methods.filter((m) =>
    m.label.toLowerCase().includes(method.replace("Pay", "").toLowerCase())
  ) ?? [];

  return (
    <Layout title="Top Up" showBack showNav={false}>
      <div className="space-y-4 pb-32">
        <Glass className="p-4">
          <div className="text-xs font-medium text-muted-foreground mb-2">Amount (KS)</div>
          <div className="text-3xl font-bold">
            <input
              type="number"
              min={1000}
              value={amount}
              onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
              className="bg-transparent outline-none w-full"
              data-testid="input-amount"
            />
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3">
            {QUICK.map((v) => (
              <button
                key={v}
                onClick={() => { haptic("selection"); setAmount(v); }}
                className={cn(
                  "pressable rounded-xl py-2 text-sm font-medium border",
                  amount === v ? "bg-primary text-white border-primary" : "glass border-white/10"
                )}
                data-testid={`quick-${v}`}
              >
                {ks(v)}
              </button>
            ))}
          </div>
        </Glass>

        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2 px-1">Payment method</div>
          <div className="grid grid-cols-2 gap-2">
            {METHODS.map((m) => (
              <button
                key={m.id}
                onClick={() => { haptic("selection"); setMethod(m.id); }}
                className={cn(
                  "pressable rounded-2xl p-3 text-sm font-medium border text-left",
                  method === m.id ? "glass-blue border-primary/50" : "glass border-white/10"
                )}
                data-testid={`method-${m.id}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {pmQ.isLoading ? (
          <Skeleton className="h-24" />
        ) : matched.length > 0 ? (
          <Glass className="p-4 space-y-3">
            <div className="text-xs font-medium text-muted-foreground">Send to</div>
            {matched.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{m.accountName}</div>
                  <div className="text-xs font-mono text-muted-foreground truncate">{m.accountNumber}</div>
                </div>
                <button
                  onClick={() => copyText(m.accountNumber, m.id)}
                  className="pressable glass-strong rounded-xl h-9 w-9 flex items-center justify-center"
                  data-testid={`copy-${m.id}`}
                >
                  {copied === m.id ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            ))}
          </Glass>
        ) : (
          <Glass className="p-4 text-sm text-muted-foreground">
            No account info on file for this gateway yet — please contact support after submitting.
          </Glass>
        )}

        <Glass className="p-4">
          <div className="text-xs font-medium text-muted-foreground mb-1">Your reference (optional)</div>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Payment txn ID, sender phone, note…"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 outline-none focus:border-primary text-sm"
            data-testid="input-reference"
          />
        </Glass>

        <Glass className="p-3 text-xs text-muted-foreground leading-relaxed">
          After paying, send the screenshot to the bot in Telegram. An admin will review and credit your wallet — usually within minutes.
        </Glass>

        <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 bg-gradient-to-t from-background to-transparent">
          <button
            disabled={amount < 1000 || mut.isPending}
            onClick={() => mut.mutate()}
            className="pressable w-full bg-primary text-white rounded-2xl py-4 font-semibold disabled:opacity-40"
            data-testid="button-submit-topup"
          >
            {mut.isPending ? "Submitting…" : `Submit top-up of ${ks(amount)}`}
          </button>
        </div>
      </div>
    </Layout>
  );
}
