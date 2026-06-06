import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { ObjectId } from "mongodb";
import { getCollection } from "../lib/mongodb";
import { telegramAuth } from "../middlewares/telegramAuth";
import { logger } from "../lib/logger";

const router = Router();

// ── Types ────────────────────────────────────────────────────────────────────

interface AdminDoc {
  _id: ObjectId;
  telegramId: number;
  role: string;
  isActive: boolean;
}

interface UserDoc {
  _id: ObjectId;
  telegramId: number;
  username?: string | null;
  first_name?: string | null;
  firstName?: string | null;
  balanceKS: number;
  balanceCoin: number;
  totalDeposited: number;
  membershipTier: "Silver" | "Gold" | "Platinum";
}

interface TxDoc {
  _id: ObjectId;
  userId: ObjectId;
  type: string;
  amount: number;
  txId?: string | null;
  status: string;
  paymentMethod?: string | null;
  screenshotUrl?: string | null;
  screenshotHash?: string | null;
  note?: string | null;
  rejectionReason?: string | null;
  processedBy?: number | null;
  balanceAfter?: number | null;
  timestamp: Date;
}

interface OrderDoc {
  _id: ObjectId;
  userId: ObjectId;
  status: string;
  productName?: string | null;
  productType?: string | null;
  gameId?: string | null;
  totalKS?: number | null;
  shortId?: string | null;
  trackingMsgId?: number | null;
  statusHistory?: Array<{ status: string; at: Date; byAdminId?: number; note?: string }>;
  timestamp: Date;
}

// ── Admin auth middleware ─────────────────────────────────────────────────────

async function adminAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.tgUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const tid = req.tgUser.id;
  const rawAdminId = process.env["ADMIN_ID"];
  if (rawAdminId && Number(rawAdminId) === tid) {
    return next();
  }
  try {
    const admins = await getCollection<AdminDoc>("admins");
    const rec = await admins.findOne({ telegramId: tid, isActive: true });
    if (rec) return next();
  } catch (err) {
    logger.error({ err }, "adminAuth DB error");
  }
  res.status(403).json({ error: "Forbidden" });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const COIN_BONUS_RATE: Record<string, number> = {
  Silver: 0.01,
  Gold: 0.015,
  Platinum: 0.02,
};

function calcTier(totalDeposited: number): "Silver" | "Gold" | "Platinum" {
  if (totalDeposited >= 2_000_000) return "Platinum";
  if (totalDeposited >= 500_000) return "Gold";
  return "Silver";
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /store/admin/me
router.get("/admin/me", telegramAuth, adminAuth, async (req, res) => {
  const tid = req.tgUser!.id;
  const rawAdminId = process.env["ADMIN_ID"];
  if (rawAdminId && Number(rawAdminId) === tid) {
    res.json({ isAdmin: true, role: "Owner" });
    return;
  }
  const admins = await getCollection<AdminDoc>("admins");
  const rec = await admins.findOne({ telegramId: tid, isActive: true });
  res.json({ isAdmin: true, role: rec?.role ?? "Staff" });
});

// GET /store/admin/summary
router.get("/admin/summary", telegramAuth, adminAuth, async (_req, res) => {
  try {
    const orders = await getCollection<OrderDoc>("orders");
    const txs = await getCollection<TxDoc>("transactions");
    const [pendingOrders, processingOrders, pendingTopups] = await Promise.all([
      orders.countDocuments({ status: "Pending" }),
      orders.countDocuments({ status: "Processing" }),
      txs.countDocuments({ type: "Topup", status: "Pending" }),
    ]);
    res.json({ pendingOrders, processingOrders, pendingTopups });
  } catch (err) {
    logger.error({ err }, "admin summary error");
    res.status(500).json({ error: "Internal error" });
  }
});

// GET /store/admin/orders?status=Pending&page=1
router.get("/admin/orders", telegramAuth, adminAuth, async (req, res) => {
  try {
    const status = (req.query["status"] as string) || "Pending";
    const page = Math.max(1, parseInt(String(req.query["page"] ?? "1")));
    const limit = 20;
    const skip = (page - 1) * limit;

    const orders = await getCollection<OrderDoc>("orders");
    const users = await getCollection<UserDoc>("users");

    const docs = await orders.find({ status }).sort({ timestamp: -1 }).skip(skip).limit(limit).toArray();

    const userObjIds: ObjectId[] = Array.from(new Set(docs.map((o) => o.userId.toString()))).map(
      (s) => new ObjectId(s),
    );
    const userDocs = await users.find({ _id: { $in: userObjIds } } as never).toArray();
    const userMap = Object.fromEntries(userDocs.map((u) => [u._id.toString(), u]));

    const items = docs.map((o) => {
      const u = userMap[o.userId.toString()];
      return {
        id: o._id.toString(),
        shortId: o.shortId,
        status: o.status,
        productName: o.productName,
        productType: o.productType,
        gameId: o.gameId,
        totalKS: o.totalKS,
        timestamp: o.timestamp,
        statusHistory: o.statusHistory ?? [],
        user: u
          ? {
              id: u._id.toString(),
              telegramId: u.telegramId,
              name: u.first_name ?? u.firstName ?? u.username ?? "User",
              username: u.username,
              tier: u.membershipTier,
            }
          : null,
      };
    });

    const total = await orders.countDocuments({ status });
    res.json({ items, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    logger.error({ err }, "admin orders list error");
    res.status(500).json({ error: "Internal error" });
  }
});

// PATCH /store/admin/orders/:id
router.patch("/admin/orders/:id", telegramAuth, adminAuth, async (req, res) => {
  try {
    const id = String(req.params["id"]);
    const { status, note } = req.body as { status: string; note?: string };
    const allowed = ["Processing", "Success", "Cancelled", "Refunded"];
    if (!allowed.includes(status)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }

    const orders = await getCollection<OrderDoc>("orders");
    const order = await orders.findOne({ _id: new ObjectId(id) });
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    const historyEntry = { status, at: new Date(), byAdminId: req.tgUser!.id, note: note ?? "" };
    await orders.updateOne(
      { _id: order._id },
      { $set: { status }, $push: { statusHistory: historyEntry } as never },
    );

    res.json({ ok: true, status });
  } catch (err) {
    logger.error({ err }, "admin order patch error");
    res.status(500).json({ error: "Internal error" });
  }
});

// GET /store/admin/topups
router.get("/admin/topups", telegramAuth, adminAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query["page"] ?? "1")));
    const limit = 20;
    const skip = (page - 1) * limit;

    const txs = await getCollection<TxDoc>("transactions");
    const users = await getCollection<UserDoc>("users");

    const docs = await txs
      .find({ type: "Topup", status: "Pending" })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    const userObjIds: ObjectId[] = Array.from(new Set(docs.map((t) => t.userId.toString()))).map(
      (s) => new ObjectId(s),
    );
    const userDocs = await users.find({ _id: { $in: userObjIds } } as never).toArray();
    const userMap = Object.fromEntries(userDocs.map((u) => [u._id.toString(), u]));

    const items = docs.map((t) => {
      const u = userMap[t.userId.toString()];
      return {
        id: t._id.toString(),
        txId: t.txId,
        amount: t.amount,
        amountDisplay: `${Math.round(t.amount).toLocaleString()} Ks`,
        paymentMethod: t.paymentMethod,
        screenshotUrl: t.screenshotUrl,
        timestamp: t.timestamp,
        user: u
          ? {
              id: u._id.toString(),
              telegramId: u.telegramId,
              name: u.first_name ?? u.firstName ?? u.username ?? "User",
              username: u.username,
              tier: u.membershipTier,
              balanceKS: u.balanceKS,
            }
          : null,
      };
    });

    const total = await txs.countDocuments({ type: "Topup", status: "Pending" });
    res.json({ items, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    logger.error({ err }, "admin topups list error");
    res.status(500).json({ error: "Internal error" });
  }
});

// PATCH /store/admin/topups/:id/approve
router.patch("/admin/topups/:id/approve", telegramAuth, adminAuth, async (req, res) => {
  try {
    const id = String(req.params["id"]);
    const adminTid = req.tgUser!.id;

    const txs = await getCollection<TxDoc>("transactions");
    const users = await getCollection<UserDoc>("users");

    const tx = await txs.findOne({ _id: new ObjectId(id), type: "Topup", status: "Pending" });
    if (!tx) {
      res.status(404).json({ error: "Pending top-up not found" });
      return;
    }

    const originalTxId = tx.txId;
    const dupKey = `${originalTxId}_approved`;
    const dup = await txs.findOne({ txId: dupKey });
    if (dup) {
      res.status(409).json({ error: "Already approved" });
      return;
    }

    const user = await users.findOne({ _id: tx.userId });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const amountKS = tx.amount;
    const rate = COIN_BONUS_RATE[user.membershipTier] ?? COIN_BONUS_RATE["Silver"]!;
    const bonusCoins = Math.floor(amountKS * rate);
    const newBalance = user.balanceKS + amountKS;
    const newCoin = user.balanceCoin + bonusCoins;
    const newTotalDeposited = (user.totalDeposited ?? 0) + amountKS;
    const newTier = calcTier(newTotalDeposited);

    await txs.updateOne(
      { _id: tx._id },
      {
        $set: {
          status: "Completed",
          processedBy: adminTid,
          balanceAfter: newBalance,
          note: "Approved by admin (Mini App)",
          txId: dupKey,
        },
      },
    );

    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          balanceKS: newBalance,
          balanceCoin: newCoin,
          totalDeposited: newTotalDeposited,
          membershipTier: newTier,
        },
      },
    );

    await txs.insertOne({
      _id: new ObjectId(),
      userId: user._id,
      type: "Topup",
      amount: amountKS,
      txId: dupKey,
      status: "Completed",
      paymentMethod: tx.paymentMethod ?? null,
      screenshotUrl: tx.screenshotUrl ?? null,
      screenshotHash: tx.screenshotHash ?? null,
      note: `Top-up approved — ${tx.paymentMethod ?? ""}`,
      processedBy: adminTid,
      balanceAfter: newBalance,
      rejectionReason: null,
      timestamp: new Date(),
    } as never);

    res.json({ ok: true, amountKS, bonusCoins, newTier });
  } catch (err) {
    // Race condition: two concurrent approve requests — treat as already approved
    if ((err as any)?.code === 11000) {
      res.status(409).json({ error: "Already approved" });
      return;
    }
    logger.error({ err }, "admin topup approve error");
    res.status(500).json({ error: "Internal error" });
  }
});

// PATCH /store/admin/topups/:id/reject
router.patch("/admin/topups/:id/reject", telegramAuth, adminAuth, async (req, res) => {
  try {
    const id = String(req.params["id"]);
    const { reason } = req.body as { reason?: string };
    const adminTid = req.tgUser!.id;

    const txs = await getCollection<TxDoc>("transactions");
    const tx = await txs.findOne({ _id: new ObjectId(id), type: "Topup", status: "Pending" });
    if (!tx) {
      res.status(404).json({ error: "Pending top-up not found" });
      return;
    }

    await txs.updateOne(
      { _id: tx._id },
      {
        $set: {
          status: "Rejected",
          processedBy: adminTid,
          rejectionReason: reason ?? "Rejected by admin",
          note: `Rejected: ${reason ?? "no reason given"}`,
        },
      },
    );

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "admin topup reject error");
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
