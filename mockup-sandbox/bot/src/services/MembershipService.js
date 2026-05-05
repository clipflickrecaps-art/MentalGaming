/**
 * MembershipService — runtime editable tier system.
 * Supports default Silver/Gold/Platinum and optional custom tiers from GameConfig.customTiers.
 */

const User = require('../models/User');
const { auditLog } = require('./logger');

const DEFAULT_TIERS = [
  { name: 'Silver',   min: 0,         discount: 0, badge: '🥈', color: '⬜', bonusRate: 0.01 },
  { name: 'Gold',     min: 500_000,   discount: 2, badge: '🥇', color: '🟨', bonusRate: 0.015 },
  { name: 'Platinum', min: 2_000_000, discount: 5, badge: '💎', color: '🟦', bonusRate: 0.02 },
];

const TIER_CONFIG = {
  Silver:   { min: 0,         discount: 0, badge: '🥈', color: '⬜', next: 'Gold', bonusRate: 0.01 },
  Gold:     { min: 500_000,   discount: 2, badge: '🥇', color: '🟨', next: 'Platinum', bonusRate: 0.015 },
  Platinum: { min: 2_000_000, discount: 5, badge: '💎', color: '🟦', next: null, bonusRate: 0.02 },
};

let _tierCache = null;
let _tierCacheExpiry = 0;

function normaliseTiers(raw) {
  const cleaned = (raw || [])
    .map((t) => ({
      name: String(t.name || '').trim(),
      min: Math.max(0, Number(t.min || 0)),
      discount: Math.max(0, Number(t.discount || 0)),
      badge: String(t.badge || '⭐').trim() || '⭐',
      color: String(t.color || '▫️').trim() || '▫️',
      bonusRate: Math.max(0, Number(t.bonusRate || 0)),
    }))
    .filter((t) => t.name);

  const unique = [];
  const seen = new Set();
  for (const t of cleaned) {
    const key = t.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(t);
  }
  unique.sort((a, b) => a.min - b.min);
  if (!unique.length || unique[0].min !== 0) {
    unique.unshift({ name: 'Silver', min: 0, discount: 0, badge: '🥈', color: '⬜', bonusRate: 0.01 });
  }
  return unique;
}

function tiersToConfig(tiers) {
  const cfg = {};
  tiers.forEach((t, idx) => {
    cfg[t.name] = { ...t, next: tiers[idx + 1]?.name || null };
  });
  return cfg;
}

async function getTierList() {
  if (Date.now() < _tierCacheExpiry && _tierCache?.list) return _tierCache.list;
  try {
    const GameConfig = require('../models/GameConfig');
    const cfg = await GameConfig.get();
    const raw = cfg.customTiers?.length ? cfg.customTiers : [
      { name: 'Silver', min: 0, discount: cfg.tierSilverDiscount, badge: '🥈', color: '⬜', bonusRate: cfg.coinBonusRateSilver },
      { name: 'Gold', min: cfg.tierGoldMin, discount: cfg.tierGoldDiscount, badge: '🥇', color: '🟨', bonusRate: cfg.coinBonusRateGold },
      { name: 'Platinum', min: cfg.tierPlatinumMin, discount: cfg.tierPlatinumDiscount, badge: '💎', color: '🟦', bonusRate: cfg.coinBonusRatePlatinum },
    ];
    const list = normaliseTiers(raw);
    _tierCache = { list, config: tiersToConfig(list) };
    _tierCacheExpiry = Date.now() + 5_000; // short cache so admin changes appear fast
    return list;
  } catch (e) {
    return DEFAULT_TIERS;
  }
}

async function getTierConfig() {
  if (Date.now() < _tierCacheExpiry && _tierCache?.config) return _tierCache.config;
  const list = await getTierList();
  return tiersToConfig(list);
}

function invalidateTierCache() {
  _tierCache = null;
  _tierCacheExpiry = 0;
}

async function calcTierFromDeposited(totalDeposited) {
  const tiers = await getTierList();
  const deposited = Number(totalDeposited || 0);
  let current = tiers[0].name;
  for (const t of tiers) {
    if (deposited >= t.min) current = t.name;
  }
  return current;
}

async function applyTierDiscount(basePrice, tier) {
  const cfg = await getTierConfig();
  const pct = cfg[tier]?.discount || 0;
  const discount = Math.floor(basePrice * (pct / 100));
  return { finalPrice: basePrice - discount, discount, pct };
}

function formatProgressBar(filled, total = 10, char = { on: '■', off: '□' }) {
  const safe = Math.max(0, Math.min(1, Number(filled || 0)));
  const filledCount = Math.round(safe * total);
  return char.on.repeat(filledCount) + char.off.repeat(total - filledCount);
}

async function getTierProgress(telegramId) {
  const user = await User.findByTelegramId(telegramId);
  if (!user) return null;

  const deposited = user.totalDeposited || 0;
  const cfg = await getTierConfig();
  let tier = user.membershipTier;
  if (!cfg[tier]) tier = await calcTierFromDeposited(deposited);
  const cur = cfg[tier] || Object.values(cfg)[0];
  const nextTier = cur.next;

  if (!nextTier) {
    return {
      tier, deposited, nextTier: null, progressPct: 100, bar: formatProgressBar(1),
      ksToNext: 0, badge: cur.badge, discount: cur.discount,
      message: `🏆 Highest tier reached — *${tier}*!`,
    };
  }

  const next = cfg[nextTier];
  const range = Math.max(1, next.min - cur.min);
  const progress = Math.max(0, deposited - cur.min);
  const pct = Math.min(progress / range, 1);
  const ksToNext = Math.max(0, next.min - deposited);

  return {
    tier, deposited, nextTier,
    progressPct: Math.round(pct * 100),
    bar: formatProgressBar(pct),
    ksToNext,
    badge: cur.badge,
    discount: cur.discount,
    nextBadge: next.badge,
    message: `Spend *${ksToNext.toLocaleString()} KS* more to reach ${next.badge} *${nextTier}*!`,
  };
}

async function checkAndUpgradeTier(userId, telegram) {
  const user = await User.findById(userId);
  if (!user) return null;

  const oldTier = user.membershipTier || 'Silver';
  const newTier = await calcTierFromDeposited(user.totalDeposited || 0);
  if (oldTier === newTier) return null;

  user.membershipTier = newTier;
  await user.save();

  await auditLog(user.telegramId, 'TIER_CHANGED', user._id.toString(), 'User', {
    from: oldTier, to: newTier, deposited: user.totalDeposited,
  });

  if (telegram) await sendLevelUpCelebration(telegram, user, oldTier, newTier).catch(() => {});
  return { oldTier, newTier };
}

async function sendLevelUpCelebration(telegram, user, oldTier, newTier) {
  const cfg = await getTierConfig();
  const newCfg = cfg[newTier] || { badge: '⭐', discount: 0, bonusRate: 0 };
  const oldCfg = cfg[oldTier] || { badge: '▫️' };
  const name = user.username ? `@${user.username}` : 'there';
  const msg =
    `🎉 *LEVEL UP! Congratulations, ${name}!*

` +
    `${oldCfg.badge} ${oldTier}  →  ${newCfg.badge} *${newTier}*

` +
    `🏷 Discount: *${newCfg.discount || 0}%*
` +
    `🪙 Coin bonus: *${Math.round((newCfg.bonusRate || 0) * 100 * 10) / 10}%*`;
  await telegram.sendMessage(user.telegramId, msg, { parse_mode: 'Markdown' });
}

module.exports = {
  TIER_CONFIG,
  getTierList,
  getTierConfig,
  invalidateTierCache,
  applyTierDiscount,
  formatProgressBar,
  getTierProgress,
  checkAndUpgradeTier,
  sendLevelUpCelebration,
  calcTierFromDeposited,
};
