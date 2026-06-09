/**
 * TierService — Dual-tier system (Lifetime + Active).
 *
 * Lifetime Tier: based on all-time completed paid order spending. Never decreases.
 * Active Tier:   based on last 365 days completed paid order spending. Can drop.
 *
 * Tiers (Bronze → Diamond):
 *   Bronze:   0 – 499,999 KS
 *   Silver:   500,000 – 1,999,999 KS
 *   Gold:     2,000,000 – 5,999,999 KS
 *   Platinum: 6,000,000 – 9,999,999 KS
 *   Diamond:  10,000,000+ KS
 *
 * MC Bonus Rates (only highest active tier applies):
 *   Bronze:   0.1%
 *   Silver:   0.3%
 *   Gold:     0.5%
 *   Platinum: 1.0%
 *   Diamond:  2.0%
 */

const Order = require('../models/Order');
const User  = require('../models/User');

// ── Tier definitions ──────────────────────────────────────────────────────────

const TIERS = [
  { id: 'Diamond',  min: 10_000_000, mcBonusPct: 2.0,  emoji: '💎', benefits: ['2% MC bonus', 'Birthday MC bonus', 'Special coupons', 'Early access promotions'] },
  { id: 'Platinum', min:  6_000_000, mcBonusPct: 1.0,  emoji: '🪙', benefits: ['1% MC bonus', 'Exclusive flash sales', 'Priority support'] },
  { id: 'Gold',     min:  2_000_000, mcBonusPct: 0.5,  emoji: '🥇', benefits: ['0.5% MC bonus', 'Priority support'] },
  { id: 'Silver',   min:    500_000, mcBonusPct: 0.3,  emoji: '🥈', benefits: ['0.3% MC bonus'] },
  { id: 'Bronze',   min:          0, mcBonusPct: 0.1,  emoji: '🥉', benefits: ['0.1% MC bonus'] },
];

const TIER_IDS = TIERS.map((t) => t.id);

function getTierForAmount(amount) {
  for (const tier of TIERS) {
    if (amount >= tier.min) return tier;
  }
  return TIERS[TIERS.length - 1]; // Bronze fallback
}

function getNextTier(currentId) {
  const idx = TIERS.findIndex((t) => t.id === currentId);
  if (idx <= 0) return null;
  return TIERS[idx - 1];
}

// ── Spending calculation ──────────────────────────────────────────────────────

async function getLifetimeSpend(userId) {
  const result = await Order.aggregate([
    { $match: { userId, status: 'Success' } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return result[0]?.total || 0;
}

async function getYearlySpend(userId) {
  const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const result = await Order.aggregate([
    { $match: { userId, status: 'Success', timestamp: { $gte: since } } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return result[0]?.total || 0;
}

// ── Tier recalculation ─────────────────────────────────────────────────────────

/**
 * Recalculate and persist both tiers for a user.
 * Call this after every completed order.
 */
async function recalcUserTiers(userId) {
  try {
    const [lifetimeSpend, yearlySpend] = await Promise.all([
      getLifetimeSpend(userId),
      getYearlySpend(userId),
    ]);

    const lifetimeTier = getTierForAmount(lifetimeSpend);
    const activeTier   = getTierForAmount(yearlySpend);

    await User.findByIdAndUpdate(userId, {
      $set: {
        lifetimeTier:  lifetimeTier.id,
        activeTier:    activeTier.id,
        lifetimeSpend,
        yearlySpend,
      },
    });

    return { lifetimeTier: lifetimeTier.id, activeTier: activeTier.id, lifetimeSpend, yearlySpend };
  } catch (err) {
    console.error('[TierService] recalcUserTiers error:', err.message);
    return null;
  }
}

/**
 * Get full tier info for API/display.
 */
async function getUserTierInfo(userId) {
  const user = await User.findById(userId).select('lifetimeTier activeTier lifetimeSpend yearlySpend');
  if (!user) return null;

  const lifetimeAmount = user.lifetimeSpend || 0;
  const yearlyAmount   = user.yearlySpend   || 0;

  const lifetimeTierDef = getTierForAmount(lifetimeAmount);
  const activeTierDef   = getTierForAmount(yearlyAmount);
  const nextActiveTier  = getNextTier(activeTierDef.id);

  return {
    lifetimeTier:    lifetimeTierDef.id,
    lifetierEmoji:   lifetimeTierDef.emoji,
    activeTier:      activeTierDef.id,
    activeTierEmoji: activeTierDef.emoji,
    mcBonusPct:      activeTierDef.mcBonusPct,
    benefits:        activeTierDef.benefits,
    lifetimeSpend:   lifetimeAmount,
    yearlySpend:     yearlyAmount,
    nextActiveTier:  nextActiveTier ? {
      id:  nextActiveTier.id,
      min: nextActiveTier.min,
      remaining: Math.max(0, nextActiveTier.min - yearlyAmount),
    } : null,
  };
}

module.exports = {
  TIERS,
  TIER_IDS,
  getTierForAmount,
  getNextTier,
  getLifetimeSpend,
  getYearlySpend,
  recalcUserTiers,
  getUserTierInfo,
};
