import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Wallet as WalletIcon, ShoppingBag, LogOut, HelpCircle, Crown, Gamepad2, ShieldCheck } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Glass } from "@/components/Glass";
import { Skeleton } from "@/components/EmptyState";
import { api, type Me } from "@/lib/api";
import { ks, coin } from "@/lib/format";
import { getTg, haptic } from "@/lib/telegram";

export default function ProfilePage() {
  const meQ = useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/me") });

  return (
    <Layout title="Profile" showNav>
      <div className="space-y-4 pt-1">
        {meQ.isLoading ? (
          <Skeleton className="h-32" />
        ) : meQ.data ? (
          <>
            <Glass variant="strong" className="p-5 flex items-center gap-4">
              <div className="h-16 w-16 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-2xl overflow-hidden">
                {meQ.data.photoUrl
                  ? <img src={meQ.data.photoUrl} alt="" className="w-full h-full object-cover" />
                  : <span>{(meQ.data.firstName || "?").slice(0, 1).toUpperCase()}</span>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-lg truncate">{meQ.data.firstName || "Guest"}</div>
                {meQ.data.username && (
                  <div className="text-xs text-muted-foreground truncate">@{meQ.data.username}</div>
                )}
                <div className="mt-1.5 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30">
                  <Crown className="h-3 w-3" /> {meQ.data.tier} member
                </div>
              </div>
            </Glass>

            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Wallet" value={ks(meQ.data.balanceKS)} sub={`+ ${coin(meQ.data.balanceCoin)}`} />
              <StatCard label="Lifetime" value={ks(meQ.data.totalDeposited)} sub={`${meQ.data.tier} tier`} />
            </div>

            <Glass className="divide-y divide-white/5">
              <NavRow href="/wallet" icon={<WalletIcon className="h-4 w-4" />} label="Wallet & transactions" />
              <NavRow href="/orders" icon={<ShoppingBag className="h-4 w-4" />} label="My orders" />
              <NavRow href="/play" icon={<Gamepad2 className="h-4 w-4" />} label="Spin, check-in & referral" />
              <NavRow href="/support" icon={<HelpCircle className="h-4 w-4" />} label="Help & support" />
              <NavRow href="/admin" icon={<ShieldCheck className="h-4 w-4" />} label="Admin Panel" />
              <NavRow
                href="#"
                icon={<LogOut className="h-4 w-4" />}
                label="Close app"
                onClick={(e) => {
                  e.preventDefault();
                  haptic("light");
                  const tg = getTg();
                  tg?.close();
                }}
              />
            </Glass>

            <div className="text-center text-[10px] text-muted-foreground pt-2">
              Mental Gaming Store · Mini App
            </div>
          </>
        ) : null}
      </div>
    </Layout>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Glass className="p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-bold mt-0.5">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </Glass>
  );
}

function NavRow({
  href, icon, label, onClick,
}: { href: string; icon: React.ReactNode; label: string; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <Link href={href}>
      <a
        onClick={onClick}
        className="pressable flex items-center gap-3 px-4 py-3.5"
        data-testid={`nav-${label}`}
      >
        <div className="h-8 w-8 rounded-full bg-white/5 flex items-center justify-center">{icon}</div>
        <span className="flex-1 text-sm font-medium">{label}</span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </a>
    </Link>
  );
}
