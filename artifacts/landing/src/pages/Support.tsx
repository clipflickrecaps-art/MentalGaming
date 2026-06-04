import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Send, MessageCircle } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Glass } from "@/components/Glass";
import { Skeleton } from "@/components/EmptyState";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/format";
import { haptic, getTg } from "@/lib/telegram";

interface Ticket {
  id: string;
  ticketId: string;
  topic: string;
  subject: string;
  status: string;
  priority: string;
  lastMessage: string | null;
  messageCount: number;
  hasAdminReply: boolean;
  at: string | null;
}
interface TicketDetail {
  id: string;
  ticketId: string;
  topic: string;
  subject: string;
  status: string;
  messages: { from: "admin" | "user"; message: string; at: string | null }[];
  at: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  open: "text-emerald-400",
  in_progress: "text-yellow-400",
  resolved: "text-primary",
  closed: "text-muted-foreground",
};

const TOPICS = [
  { id: "general",  label: "General question" },
  { id: "order",    label: "Order issue" },
  { id: "payment",  label: "Payment / top-up" },
  { id: "account",  label: "Account help" },
  { id: "other",    label: "Other" },
] as const;

export default function SupportPage() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const [topic, setTopic] = useState<string>("general");
  const [message, setMessage] = useState("");
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  const listQ = useQuery<{ tickets: Ticket[] }>({
    queryKey: ["support-tickets"],
    queryFn: () => api.get("/tickets"),
  });

  const detailQ = useQuery<TicketDetail>({
    queryKey: ["support-ticket", openTicketId],
    queryFn: () => api.get(`/tickets/${openTicketId}`),
    enabled: !!openTicketId,
    refetchInterval: openTicketId ? 10000 : false,
  });

  const createMut = useMutation<{ ticketId: string; message: string }, ApiError, void>({
    mutationFn: () => api.post("/tickets", { topic, message }),
    onSuccess: (data) => {
      haptic("success");
      setMessage("");
      qc.invalidateQueries({ queryKey: ["support-tickets"] });
      const tg = getTg();
      if (tg) tg.showAlert(data.message); else alert(data.message);
    },
    onError: (e) => {
      haptic("error");
      if (e.data && typeof e.data === "object" && "existingTicketId" in (e.data as object)) {
        const existing = (e.data as { existingTicketId: string }).existingTicketId;
        setOpenTicketId(existing);
      }
      const tg = getTg();
      if (tg) tg.showAlert(e.message); else alert(e.message);
    },
  });

  const replyMut = useMutation<{ ok: boolean }, ApiError, void>({
    mutationFn: () => api.post(`/tickets/${openTicketId}/message`, { message: replyText }),
    onSuccess: () => {
      haptic("light");
      setReplyText("");
      qc.invalidateQueries({ queryKey: ["support-ticket", openTicketId] });
    },
    onError: (e) => {
      const tg = getTg();
      if (tg) tg.showAlert(e.message); else alert(e.message);
    },
  });

  const tickets = listQ.data?.tickets ?? [];

  // ── Ticket detail view ────────────────────────────────────────────────────
  if (openTicketId && detailQ.data) {
    const t = detailQ.data;
    return (
      <Layout
        title={`#${t.ticketId}`}
        showBack
        showNav={false}
        right={
          <button onClick={() => setOpenTicketId(null)} className="text-xs text-muted-foreground px-2">
            ← Back
          </button>
        }
      >
        <div className="flex flex-col pb-36 pt-1 gap-3">
          <Glass className="p-3 text-sm flex items-center justify-between">
            <div className="text-muted-foreground truncate">{t.subject}</div>
            <span className={cn("text-xs font-medium shrink-0 ml-2", STATUS_COLOR[t.status] ?? "text-muted-foreground")}>
              {t.status}
            </span>
          </Glass>

          <div className="space-y-2">
            {t.messages.map((m, i) => (
              <div key={i} className={cn("flex", m.from === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed",
                    m.from === "user"
                      ? "bg-primary text-white rounded-br-sm"
                      : "glass border border-white/10 rounded-bl-sm"
                  )}
                >
                  {m.from === "admin" && (
                    <div className="text-[10px] text-primary mb-1 font-medium">Admin</div>
                  )}
                  {m.message}
                  {m.at && (
                    <div className="text-[10px] mt-1 opacity-60">
                      {new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {t.status !== "closed" && (
            <div className="fixed inset-x-0 bottom-0 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 bg-gradient-to-t from-background to-transparent z-40">
              <div className="flex gap-2">
                <input
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Reply…"
                  className="flex-1 glass border border-white/10 rounded-2xl px-4 py-3 text-sm outline-none focus:border-primary"
                  onKeyDown={(e) => { if (e.key === "Enter" && replyText.trim()) replyMut.mutate(); }}
                />
                <button
                  disabled={!replyText.trim() || replyMut.isPending}
                  onClick={() => replyMut.mutate()}
                  className="pressable bg-primary text-white rounded-2xl h-12 w-12 flex items-center justify-center disabled:opacity-40"
                >
                  <Send className="h-5 w-5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </Layout>
    );
  }

  // ── Ticket list + new ticket form ─────────────────────────────────────────
  return (
    <Layout title="Support" showBack showNav={false}>
      <div className="space-y-4 pb-28 pt-1">

        {/* Existing tickets */}
        {listQ.isLoading ? (
          <Skeleton className="h-24" />
        ) : tickets.length > 0 ? (
          <Glass className="divide-y divide-white/5">
            <div className="px-4 py-2 text-xs font-medium text-muted-foreground">Your Tickets</div>
            {tickets.map((t) => (
              <button
                key={t.id}
                onClick={() => { haptic("selection"); setOpenTicketId(t.ticketId); }}
                className="pressable w-full px-4 py-3 flex items-center gap-3 text-left"
                data-testid={`ticket-${t.ticketId}`}
              >
                <MessageCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{t.ticketId}</span>
                    <span className={cn("text-xs shrink-0", STATUS_COLOR[t.status] ?? "text-muted-foreground")}>
                      {t.status}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">{t.subject}</div>
                  {t.hasAdminReply && (
                    <div className="text-xs text-primary mt-0.5">💬 Admin replied</div>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </Glass>
        ) : null}

        {/* New ticket form */}
        <Glass className="p-4 space-y-3">
          <div className="text-sm font-medium">New Support Ticket</div>

          <div>
            <div className="text-xs text-muted-foreground mb-2">Topic</div>
            <div className="grid grid-cols-2 gap-2">
              {TOPICS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { haptic("selection"); setTopic(t.id); }}
                  className={cn(
                    "pressable rounded-xl py-2 px-3 text-xs font-medium border text-left",
                    topic === t.id ? "glass-blue border-primary/50" : "glass border-white/10"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs text-muted-foreground mb-2">Message</div>
            <textarea
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe your issue in detail…"
              className="w-full glass border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-primary resize-none"
              data-testid="input-support-message"
            />
          </div>

          <button
            disabled={message.trim().length < 5 || createMut.isPending}
            onClick={() => createMut.mutate()}
            className="pressable w-full bg-primary text-white rounded-2xl py-3.5 font-semibold disabled:opacity-40"
            data-testid="button-submit-ticket"
          >
            {createMut.isPending ? "Sending…" : "Send to Support"}
          </button>
        </Glass>

        <Glass className="p-3 text-xs text-muted-foreground">
          Our support team usually responds within 1–2 hours during business hours.
          For urgent order issues, please mention your order ID.
        </Glass>
      </div>
    </Layout>
  );
}
