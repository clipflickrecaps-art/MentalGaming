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

    membershipTier: { type: String, default: 'Silver' },

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
    referralCode: { type: String, default: undefined },

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

    // ── Onboarding ────────────────────────────────────────────────────────────
    onboardingDone: {
      type:    Boolean,
      default: false,
      comment: 'True after user completes or skips the first-time tour',
    },
    onboardingBonusClaimed: {
      type:    Boolean,
      default: false,
      comment: 'True once the 100 MC welcome bonus has been credited',
    },

    // ── Preferences ──────────────────────────────────────────────────────────
    theme:    { type: String, enum: ['light', 'dark', 'auto'], default: 'auto' },
    language: { type: String, enum: ['en', 'mm'], default: 'en' },
    languageSelected: { type: Boolean, default: false },
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
  // Legacy fallback only. Runtime tier updates are handled by MembershipService.
  const d = this.totalDeposited || 0;
  if (d >= 2_000_000)    this.membershipTier = 'Platinum';
  else if (d >= 500_000) this.membershipTier = 'Gold';
  else                   this.membershipTier = 'Silver';
};

userSchema.statics.findByTelegramId = function (telegramId) {
  const numId = Number(telegramId);
  // Be tolerant of old data or string IDs from Telegram callbacks.
  // Mongoose normally casts strings to Number, but this $or protects legacy docs too.
  return this.findOne({ $or: [{ telegramId: numId }, { telegramId: String(telegramId) }] });
};

userSchema.statics.findOrCreate = async function (telegramId, username, firstName) {
  // Always coerce to Number — Telegram IDs are always numeric
  const numId = Number(telegramId);

  // Step 1 — find by number OR string (handles legacy docs stored as string)
  let user = await this.findOne({ $or: [{ telegramId: numId }, { telegramId: String(telegramId) }] });

  if (user) {
    // Normalise type in background if stored as string
    if (typeof user.telegramId !== 'number') {
      this.updateOne({ _id: user._id }, { $set: { telegramId: numId, lastActive: new Date() } }).catch(() => {});
    } else {
      const patch = { lastActive: new Date() };
      if (username)  patch.username   = username;
      if (firstName) patch.first_name = firstName;
      this.updateOne({ _id: user._id }, { $set: patch }).catch(() => {});
    }
    return user;
  }

  // Step 2 — not found; create
  try {
    const makeReferralCode = () => `MGS${numId}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    user = await this.create({
      telegramId: numId,
      username:   username   || null,
      first_name: firstName  || null,
      referralCode: makeReferralCode(),
      lastActive: new Date(),
    });
    return user;
  } catch (createErr) {
    console.error('[User] create error for', numId, ':', createErr.code, createErr.message);
    // Duplicate key — race condition or legacy referralCode:null unique index problem.
    if (createErr.code === 11000) {
      const existing = await this.findOne({ $or: [{ telegramId: numId }, { telegramId: String(telegramId) }] });
      if (existing) return existing;

      // Retry once with a guaranteed referral code. This fixes old DBs where referralCode:null
      // was saved under a unique sparse index and blocked new user creation.
      try {
        return await this.create({
          telegramId: numId,
          username:   username   || null,
          first_name: firstName  || null,
          referralCode: `MGS${numId}${Date.now().toString(36).slice(-4).toUpperCase()}`,
          lastActive: new Date(),
        });
      } catch (retryErr) {
        console.error('[User] retry create error for', numId, ':', retryErr.code, retryErr.message);
      }
    }
    return null;
  }
};

module.exports = mongoose.model('User', userSchema);
