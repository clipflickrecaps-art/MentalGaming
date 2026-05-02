const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    telegramId: { type: Number, required: true, unique: true, index: true },
    username: { type: String, default: null },

    // ── Dual Wallet ──────────────────────────────────────────────────────────
    balanceKS:      { type: Number, default: 0, min: 0 },
    balanceCoin:    { type: Number, default: 0, min: 0 },
    totalDeposited: { type: Number, default: 0, min: 0 },

    membershipTier: { type: String, enum: ['Silver', 'Gold', 'Platinum'], default: 'Silver' },

    // ── Spin Wheel ───────────────────────────────────────────────────────────
    lastSpinAt: { type: Date, default: null },

    // ── Moderation ───────────────────────────────────────────────────────────
    warningsCount:    { type: Number, default: 0, min: 0 },
    restrictedRights: { type: [String], default: [] },
    isBlocked:        { type: Boolean, default: false },

    // ── Referral ─────────────────────────────────────────────────────────────
    referralCode: { type: String, default: null, unique: true, sparse: true, index: true },

    // ── Preferences ──────────────────────────────────────────────────────────
    theme:      { type: String, enum: ['light', 'dark', 'auto'], default: 'auto' },
    joinDate:   { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now },
  },
  { timestamps: true, versionKey: false }
);

userSchema.methods.hasRight = function (right) {
  return !this.restrictedRights.includes(right);
};

/**
 * Auto-upgrade tier based on totalDeposited:
 *   Silver  <  50,000 KS
 *   Gold    50,000 – 199,999 KS
 *   Platinum ≥ 200,000 KS
 */
userSchema.methods.recalcTier = function () {
  const d = this.totalDeposited || 0;
  if (d >= 200000)     this.membershipTier = 'Platinum';
  else if (d >= 50000) this.membershipTier = 'Gold';
  else                 this.membershipTier = 'Silver';
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
