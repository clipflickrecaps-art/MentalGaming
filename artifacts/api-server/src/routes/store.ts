import { Router, type IRouter, type Request, type Response } from "express";
import { ObjectId, type Filter, type WithId } from "mongodb";
import { getClient, getCollection } from "../lib/mongodb";
import { telegramAuth, type StoreUser } from "../middlewares/telegramAuth";

const router: IRouter = Router();
router.use(telegramAuth);

// ── Types mirroring bot Mongoose models ─────────────────────────────────────

interface ProductDoc {
  _id: ObjectId;
  name: string;
  category: string;
  region: string;
  productType: "DirectTopup" | "DigitalCode";
  finalPrice: number;
  flashSalePrice: number | null;
  flashSaleStart: Date | null;
  flashSaleEnd: Date | null;
  stockCount: number;
  isActive: boolean;
  imageUrl: string | null;
  description: string;
}

interface OrderDoc {
  _id: ObjectId;
  userId: ObjectId;
  productId: ObjectId;
  amount: number;
  originalAmount: number | null;
  tierDiscount: number;
  tierDiscountPct: number;
  status: "Pending" | "Processing" | "Success" | "Cancelled" | "Refunded";
  productType: "DirectTopup" | "DigitalCode";
  gameId: string | null;
  zoneId: string | null;
  gameName: string | null;
  timestamp: Date;
  notes: string;
}

interface TxDoc {
  _id: ObjectId;
  userId: ObjectId;
  type: string;
  wallet: "KS" | "Coin";
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  status: "Pending" | "Completed" | "Rejected";
  paymentMethod: string | null;
  description?: string;
  createdAt?: Date;
  timestamp?: Date;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function effectivePrice(p: ProductDoc): number {
  const now = Date.now();
  if (
    p.flashSalePrice &&
    p.flashSaleStart &&
    p.flashSaleEnd &&
    new Date(p.flashSaleStart).getTime() <= now &&
    new Date(p.flashSaleEnd).getTime() >= now
  ) {
    return p.flashSalePrice;
  }
  return p.finalPrice;
}

function tierDiscountPct(tier: StoreUser["membershipTier"]): number {
  if (tier === "Platinum") return 5;
  if (tier === "Gold") return 2;
  return 0;
}

function publicProduct(p: ProductDoc) {
  const effective = effectivePrice(p);
  const onSale = effective < p.finalPrice;
  return {
    id: p._id.toString(),
    name: p.name,
    category: p.category,
    region: p.region,
    productType: p.productType,
    price: p.finalPrice,
    effectivePrice: effective,
    onSale,
    flashSaleEnd: onSale ? p.flashSaleEnd : null,
    inStock: p.stockCount === -1 || p.stockCount > 0,
    imageUrl: p.imageUrl,
    description: p.description,
  };
}

function safeId(s: string): ObjectId | null {
  return ObjectId.isValid(s) ? new ObjectId(s) : null;
}

function asUser(req: Request): StoreUser {
  return req.storeUser as StoreUser;
}

// ── GET /me ────────────────────────────────────────────────────────────────

router.get("/me", (req: Request, res: Response) => {
  const u = asUser(req);
  res.json({
    id: u._id.toString(),
    telegramId: u.telegramId,
    username: u.username,
    firstName: u.first_name,
    balanceKS: u.balanceKS,
    balanceCoin: u.balanceCoin,
    totalDeposited: u.totalDeposited,
    tier: u.membershipTier,
    language: u.language,
    photoUrl: req.tgUser?.photo_url || null,
    tierDiscountPct: tierDiscountPct(u.membershipTier),
  });
});

// ── GET /products ──────────────────────────────────────────────────────────

router.get("/products", async (req: Request, res: Response) => {
  const products = await getCollection<ProductDoc>("products");
  const filter: Filter<ProductDoc> = { isActive: true };
  const cat = req.query["category"];
  if (typeof cat === "string" && cat) filter.category = cat;
  const search = req.query["search"];
  if (typeof search === "string" && search) {
    filter.name = { $regex: search, $options: "i" };
  }
  const docs = await products
    .find(filter)
    .sort({ category: 1, name: 1 })
    .limit(200)
    .toArray();

  // Categories (distinct + counts)
  const allActive = await products
    .find({ isActive: true }, { projection: { category: 1 } })
    .toArray();
  const catMap = new Map<string, number>();
  for (const p of allActive) catMap.set(p.category, (catMap.get(p.category) || 0) + 1);
  const categories = [...catMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  res.json({ products: docs.map(publicProduct), categories });
});

// ── GET /products/:id ──────────────────────────────────────────────────────

router.get("/products/:id", async (req: Request, res: Response) => {
  const id = safeId(String(req.params["id"] ?? ""));
  if (!id) return res.status(400).json({ error: "Bad product id" });

  const products = await getCollection<ProductDoc>("products");
  const p = await products.findOne({ _id: id, isActive: true });
  if (!p) return res.status(404).json({ error: "Product not found" });
  return res.json(publicProduct(p));
});

// ── GET /flashsale ─────────────────────────────────────────────────────────

router.get("/flashsale", async (_req: Request, res: Response) => {
  const products = await getCollection<ProductDoc>("products");
  const now = new Date();
  const docs = await products
    .find({
      isActive: true,
      flashSalePrice: { $gt: 0 },
      flashSaleStart: { $lte: now },
      flashSaleEnd: { $gte: now },
    })
    .limit(20)
    .toArray();
  res.json({ products: docs.map(publicProduct) });
});

// ── POST /orders ───────────────────────────────────────────────────────────
// body: { productId, gameId?, zoneId?, paymentMethod: "wallet" | "coin" }

router.post("/orders", async (req: Request, res: Response) => {
  const u = asUser(req);
  const body = req.body as {
    productId?: string;
    gameId?: string;
    zoneId?: string;
    paymentMethod?: "wallet" | "coin";
  };

  const pid = safeId(body.productId || "");
  if (!pid) return res.status(400).json({ error: "Bad product id" });

  const products = await getCollection<ProductDoc>("products");
  const product = await products.findOne({ _id: pid, isActive: true });
  if (!product) return res.status(404).json({ error: "Product not found" });
  if (!(product.stockCount === -1 || product.stockCount > 0)) {
    return res.status(409).json({ error: "Out of stock" });
  }

  if (product.productType === "DirectTopup") {
    if (!body.gameId || !body.gameId.trim()) {
      return res.status(400).json({ error: "Game ID is required" });
    }
  }

  const baseAmount = effectivePrice(product);
  const tierPct = tierDiscountPct(u.membershipTier);
  const tierDiscount = Math.round((baseAmount * tierPct) / 100);
  const finalAmount = Math.max(0, baseAmount - tierDiscount);

  const method = body.paymentMethod === "coin" ? "coin" : "wallet";
  const wallet: "KS" | "Coin" = method === "coin" ? "Coin" : "KS";
  const balanceField = method === "coin" ? "balanceCoin" : "balanceKS";
  const currentBalance =
    method === "coin" ? u.balanceCoin : u.balanceKS;

  if (currentBalance < finalAmount) {
    return res.status(402).json({
      error:
        method === "coin"
          ? "Not enough Mental Coins"
          : "Not enough wallet balance",
      needed: finalAmount,
      balance: currentBalance,
    });
  }

  const users = await getCollection<StoreUser>("users");
  const orders = await getCollection<OrderDoc>("orders");
  const txs = await getCollection<TxDoc>("transactions");
  const now = new Date();
  const orderId = new ObjectId();

  // Atomic debit: conditional update on balance prevents overspend race.
  // Returns the POST-debit document so the ledger reflects truth even under
  // concurrent purchases.
  const debited = await users.findOneAndUpdate(
    { _id: u._id, [balanceField]: { $gte: finalAmount } },
    { $inc: { [balanceField]: -finalAmount }, $set: { lastActive: now } },
    { returnDocument: "after" }
  );
  if (!debited) {
    return res.status(402).json({ error: "Balance changed, please retry" });
  }
  const balanceAfter =
    method === "coin" ? debited.balanceCoin : debited.balanceKS;
  const balanceBefore = balanceAfter + finalAmount;

  const orderDoc: OrderDoc = {
    _id: orderId,
    userId: u._id,
    productId: product._id,
    amount: finalAmount,
    originalAmount: baseAmount,
    tierDiscount,
    tierDiscountPct: tierPct,
    status: "Pending",
    productType: product.productType,
    gameId: body.gameId?.trim() || null,
    zoneId: body.zoneId?.trim() || null,
    gameName: product.name,
    timestamp: now,
    notes: "Placed via Mini App",
  };

  try {
    await orders.insertOne(orderDoc);
    await txs.insertOne({
      _id: new ObjectId(),
      userId: u._id,
      type: "Purchase",
      wallet,
      amount: -finalAmount,
      balanceBefore,
      balanceAfter,
      status: "Completed",
      paymentMethod: null,
      description: `Order ${orderId.toString()} — ${product.name}`,
      createdAt: now,
      timestamp: now,
    });
  } catch (err) {
    // Compensating refund — keep wallet whole if order/tx writes fail.
    try {
      await users.updateOne(
        { _id: u._id },
        { $inc: { [balanceField]: finalAmount } }
      );
      await orders.deleteOne({ _id: orderId }).catch(() => {});
    } catch {
      /* best effort */
    }
    // Re-throw so the global error handler logs it and the client sees 500.
    throw err;
  }

  // Touch client only for connection liveness check (no-op if already there).
  void getClient();

  return res.json({
    orderId: orderId.toString(),
    amount: finalAmount,
    status: "Pending",
  });
});

// ── GET /orders ────────────────────────────────────────────────────────────

router.get("/orders", async (req: Request, res: Response) => {
  const u = asUser(req);
  const orders = await getCollection<OrderDoc>("orders");
  const filter: Filter<OrderDoc> = { userId: u._id };
  const statusQ = req.query["status"];
  const status = typeof statusQ === "string" ? statusQ : "";
  if (["Pending", "Processing", "Success", "Cancelled", "Refunded"].includes(status)) {
    filter.status = status as OrderDoc["status"];
  }

  const docs = await orders
    .find(filter)
    .sort({ timestamp: -1 })
    .limit(50)
    .toArray();

  const productIds = [...new Set(docs.map((o) => o.productId.toString()))]
    .map((s) => new ObjectId(s));
  const products = await getCollection<ProductDoc>("products");
  const pDocs = productIds.length
    ? await products
        .find({ _id: { $in: productIds } }, { projection: { name: 1, category: 1, imageUrl: 1 } })
        .toArray()
    : [];
  const pMap = new Map(pDocs.map((p) => [p._id.toString(), p]));

  res.json({
    orders: docs.map((o) => ({
      id: o._id.toString(),
      shortId: o._id.toString().slice(-6).toUpperCase(),
      productName: pMap.get(o.productId.toString())?.name || o.gameName || "Order",
      productImage: pMap.get(o.productId.toString())?.imageUrl || null,
      amount: o.amount,
      status: o.status,
      gameId: o.gameId,
      zoneId: o.zoneId,
      timestamp: o.timestamp,
    })),
  });
});

// ── GET /orders/:id ────────────────────────────────────────────────────────

router.get("/orders/:id", async (req: Request, res: Response) => {
  const u = asUser(req);
  const id = safeId(String(req.params["id"] ?? ""));
  if (!id) return res.status(400).json({ error: "Bad order id" });

  const orders = await getCollection<OrderDoc>("orders");
  const o = await orders.findOne({ _id: id, userId: u._id });
  if (!o) return res.status(404).json({ error: "Order not found" });

  const products = await getCollection<ProductDoc>("products");
  const p = await products.findOne({ _id: o.productId });

  return res.json({
    id: o._id.toString(),
    shortId: o._id.toString().slice(-6).toUpperCase(),
    product: p ? publicProduct(p) : null,
    amount: o.amount,
    originalAmount: o.originalAmount,
    tierDiscount: o.tierDiscount,
    status: o.status,
    gameId: o.gameId,
    zoneId: o.zoneId,
    timestamp: o.timestamp,
    notes: o.notes,
  });
});

// ── GET /wallet ────────────────────────────────────────────────────────────

router.get("/wallet", async (req: Request, res: Response) => {
  const u = asUser(req);
  const txs = await getCollection<TxDoc>("transactions");
  const docs = await txs
    .find({ userId: u._id })
    .sort({ createdAt: -1, timestamp: -1 })
    .limit(30)
    .toArray();

  res.json({
    balanceKS: u.balanceKS,
    balanceCoin: u.balanceCoin,
    tier: u.membershipTier,
    totalDeposited: u.totalDeposited,
    history: docs.map((t: WithId<TxDoc>) => ({
      id: t._id.toString(),
      type: t.type,
      wallet: t.wallet,
      amount: t.amount,
      status: t.status,
      paymentMethod: t.paymentMethod,
      description: t.description || null,
      at: t.createdAt || t.timestamp || null,
    })),
  });
});

// ── POST /topups ───────────────────────────────────────────────────────────
// body: { amount, paymentMethod, reference? }
// Creates a Pending Topup transaction. Admin approves in bot.

router.post("/topups", async (req: Request, res: Response) => {
  const u = asUser(req);
  const body = req.body as {
    amount?: number;
    paymentMethod?: string;
    reference?: string;
  };
  const amount = Number(body.amount);
  const method = String(body.paymentMethod || "").trim();
  if (!Number.isFinite(amount) || amount < 1000) {
    return res.status(400).json({ error: "Minimum top-up is 1,000 KS" });
  }
  if (!["KPay", "WavePay", "AYAPay", "CBPay"].includes(method)) {
    return res.status(400).json({ error: "Invalid payment method" });
  }

  const txs = await getCollection<TxDoc>("transactions");
  const now = new Date();
  const ins = await txs.insertOne({
    _id: new ObjectId(),
    userId: u._id,
    type: "Topup",
    wallet: "KS",
    amount,
    balanceBefore: u.balanceKS,
    balanceAfter: u.balanceKS,
    status: "Pending",
    paymentMethod: method,
    description: body.reference?.toString().slice(0, 80) || "Mini App top-up",
    createdAt: now,
    timestamp: now,
  });

  return res.json({
    requestId: ins.insertedId.toString(),
    status: "Pending",
    message:
      "Top-up request submitted. Send your payment screenshot to the bot to speed up approval.",
  });
});

// ── GET /payment-methods ───────────────────────────────────────────────────

router.get("/payment-methods", async (_req: Request, res: Response) => {
  type PMDoc = {
    _id: ObjectId;
    name: string;
    shortCode: string;
    accountName: string;
    accountNumber: string;
    emoji?: string;
    isActive: boolean;
    displayOrder?: number;
  };
  const pms = await getCollection<PMDoc>("paymentmethods");
  const docs = await pms
    .find({ isActive: true })
    .sort({ displayOrder: 1, name: 1 })
    .toArray();
  res.json({
    methods: docs.map((m) => ({
      id: m._id.toString(),
      label: m.name,
      shortCode: m.shortCode,
      emoji: m.emoji || "💳",
      accountName: m.accountName,
      accountNumber: m.accountNumber,
    })),
  });
});

export default router;
