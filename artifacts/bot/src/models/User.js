const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    telegramId: { type: Number, required: true, unique: true },
    username:   { type: String, default: null },
    first_name: { type: String, default: null },

    // ── Dual Wallet ──────────────────────────────────────────────────────────
    balanceKS:      { type: Number, default: 0, min: 0 },
    balanceCoin:    { type: Number, default: 0, min: 0 },
    totalDeposited: { type: Number, default: 0, min: 0 },

    membershipTier: { type: String, enum: ['Silver', 'Gold', 'Platinum'], default: 'Silver' },

    // ── Spin Wheel ───────────────────────────────────────────────────────────
    lastSpinAt: { type: Date, default: null },

    // ── Daily Check-In ───────────────────────────────────────────────────────
    checkInStreak:   { type: Number, default: 0, min: 0 },
    longestStreak:   { type: Number, default: 0, min: 0 },
    totalCheckIns:   { type: Number, default: 0, min: 0 },
    lastCheckInDate: { type: String, default: null },

    // ── Moderation ───────────────────────────────────────────────────────────
    warningsCount:     { type: Number, default: 0, min: 0 },
    restrictedRights:  { type: [String], default: [] },
    restrictedUntil:   { type: Date, default: null },
    restrictionReason: { type: String, default: null },
    isBlocked:         { type: Boolean, default: false },

    // ── Referral ─────────────────────────────────────────────────────────────
    referralCode: { type: String, default: null },

    // ── Attribution Analytics ─────────────────────────────────────────────────
    // Tracks where the user came from on first join (never overwritten after set).
    joinSource: {
      type: String,
      enum:    ['direct', 'referral', 'channel', 'share', 'unknown'],
      default: 'unknown',
      index:   true,
      comment: 'How the user first found the bot',
    },
    joinRef: {
      type:    String,
      default: null,
      comment: 'referral code | channel post ID | product ID | null',
    },

    // ── Preferences ──────────────────────────────────────────────────────────
    theme:      { type: String, enum: ['light', 'dark', 'auto'], default: 'auto' },
    joinDate:   { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now },
  },
  { timestamps: true, versionKey: false }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
userSchema.index({ referralCode: 1 }, { unique: true, sparse: true });

userSchema.methods.hasRight = function (right) {
  return !this.restrictedRights.includes(right);
};

userSchema.methods.recalcTier = function () {
  const d = this.totalDeposited || 0;
  if (d >= 2_000_000)    this.membershipTier = 'Platinum';
  else if (d >= 500_000) this.membershipTier = 'Gold';
  else                   this.membershipTier = 'Silver';
};

userSchema.statics.findByTelegramId = function (telegramId) {
  return this.findOne({ telegramId });
};

userSchema.statics.findOrCreate = async function (telegramId, username, firstName) {
  try {
    const setFields = { lastActive: new Date() };
    if (username)  setFields.username   = username;
    if (firstName) setFields.first_name = firstName;

    return await this.findOneAndUpdate(
      { telegramId },
      { $setOnInsert: { telegramId }, $set: setFields },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    if (err.code === 11000) return this.findOne({ telegramId });
    throw err;
  }
};

module.exports = mongoose.model('User', userSchema);
