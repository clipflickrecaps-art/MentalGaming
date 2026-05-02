const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    telegramId: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },
    username: {
      type: String,
      default: null,
    },

    // ── Dual Wallet ──────────────────────────────────────────────────────
    balanceKS: {
      type: Number,
      default: 0,
      min: 0,
      comment: 'Main store currency in KS (Kyat Store)',
    },
    balanceCoin: {
      type: Number,
      default: 0,
      min: 0,
      comment: 'Mental Coins — earned via top-ups and purchases',
    },
    totalDeposited: {
      type: Number,
      default: 0,
      min: 0,
      comment: 'Lifetime KS deposited — for VIP tier calculation',
    },

    membershipTier: {
      type: String,
      enum: ['Silver', 'Gold', 'Platinum'],
      default: 'Silver',
    },
    warningsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    restrictedRights: {
      type: [String],
      default: [],
    },
    theme: {
      type: String,
      enum: ['light', 'dark', 'auto'],
      default: 'auto',
    },
    joinDate: {
      type: Date,
      default: Date.now,
    },
    isBlocked: {
      type: Boolean,
      default: false,
    },
    lastActive: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true, versionKey: false }
);

// ── Helpers ─────────────────────────────────────────────────────────────────

userSchema.methods.hasRight = function (right) {
  return !this.restrictedRights.includes(right);
};

userSchema.methods.addWarning = async function () {
  this.warningsCount += 1;
  if (this.warningsCount >= 3) this.isBlocked = true;
  return this.save();
};

/**
 * Auto-upgrade membership tier based on totalDeposited:
 *   Silver  < 50,000 KS
 *   Gold    50,000 – 199,999 KS
 *   Platinum ≥ 200,000 KS
 */
userSchema.methods.recalcTier = function () {
  const deposited = this.totalDeposited || 0;
  if (deposited >= 200000) this.membershipTier = 'Platinum';
  else if (deposited >= 50000) this.membershipTier = 'Gold';
  else this.membershipTier = 'Silver';
};

userSchema.statics.findByTelegramId = function (telegramId) {
  return this.findOne({ telegramId });
};

userSchema.statics.findOrCreate = async function (telegramId, username) {
  let user = await this.findOne({ telegramId });
  if (!user) {
    user = await this.create({ telegramId, username });
  } else {
    user.lastActive = new Date();
    if (username && user.username !== username) user.username = username;
    await user.save();
  }
  return user;
};

module.exports = mongoose.model('User', userSchema);
