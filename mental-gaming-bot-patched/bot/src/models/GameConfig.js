/**
 * GameConfig — singleton document for runtime-editable game settings.
 * Admin can update these values from the bot without restarting.
 *
 * Covers:
 *   • Coin bonus rates per tier (applied on top-up approval)
 *   • Tier thresholds (total KS deposited to reach Gold/Platinum)
 *   • Tier discount percentages
 *   • Spin wheel cost and per-prize weights
 */

const mongoose = require('mongoose');

const SINGLETON_ID = 'global';

const gameConfigSchema = new mongoose.Schema(
  {
    _id: { type: String, default: SINGLETON_ID },

    // ── Coin Bonus Rates (% of KS → Mental Coins on Topup) ─────────────────
    coinBonusRateSilver:   { type: Number, default: 0.01  }, // 1%
    coinBonusRateGold:     { type: Number, default: 0.015 }, // 1.5%
    coinBonusRatePlatinum: { type: Number, default: 0.02  }, // 2%

    // ── Tier Thresholds (total KS deposited) ────────────────────────────────
    tierGoldMin:     { type: Number, default: 500_000   },
    tierPlatinumMin: { type: Number, default: 2_000_000 },

    // ── Tier Discounts (% off final product price) ──────────────────────────
    tierSilverDiscount:   { type: Number, default: 0 },
    tierGoldDiscount:     { type: Number, default: 2 },
    tierPlatinumDiscount: { type: Number, default: 5 },

    // Fully editable tier list. If filled, this replaces the legacy Silver/Gold/Platinum fields.
    // Format: [{ name, min, discount, badge, color, bonusRate }]
    customTiers: {
      type: [{
        name: { type: String, required: true },
        min: { type: Number, default: 0 },
        discount: { type: Number, default: 0 },
        badge: { type: String, default: '⭐' },
        color: { type: String, default: '▫️' },
        bonusRate: { type: Number, default: 0 },
      }],
      default: [],
    },

    // ── Spin Wheel ───────────────────────────────────────────────────────────
    spinCostCoins: { type: Number, default: 50 },

    spinWeightThanks:    { type: Number, default: 55 },
    spinWeightCoins50:   { type: Number, default: 25 },
    spinWeightCoins200:  { type: Number, default: 10 },
    spinWeightCoins500:  { type: Number, default: 5  },
    spinWeightKS1000:    { type: Number, default: 3  },
    spinWeightKS5000:    { type: Number, default: 1  },
    spinWeightFreeSpin:  { type: Number, default: 1  },

    // Runtime editable custom spin prizes. If not empty, replaces default prize pool.
    spinPrizes: {
      type: [{
        id: String,
        label: String,
        type: { type: String, enum: ['none', 'coin', 'ks', 'spin'], default: 'none' },
        value: { type: Number, default: 0 },
        weight: { type: Number, default: 1 },
      }],
      default: [],
    },

    // Editable Daily Check-In reward table. 7 rows are used and repeat weekly.
    checkInRewards: {
      type: [{ coins: Number, ks: Number, label: String }],
      default: () => [],
    },
  },
  { timestamps: true, versionKey: false }
);

gameConfigSchema.statics.get = async function () {
  let doc = await this.findById(SINGLETON_ID);
  if (!doc) doc = await this.create({ _id: SINGLETON_ID });
  return doc;
};

gameConfigSchema.statics.set = async function (fields) {
  return this.findByIdAndUpdate(
    SINGLETON_ID,
    { $set: fields },
    { upsert: true, new: true }
  );
};

module.exports = mongoose.model('GameConfig', gameConfigSchema);
