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
    walletBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    mentalCoins: {
      type: Number,
      default: 0,
      min: 0,
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
      comment: 'UI theme preference: auto follows Myanmar Standard Time (6PM-6AM = dark)',
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
  {
    timestamps: true,
    versionKey: false,
  }
);

userSchema.methods.hasRight = function (right) {
  return !this.restrictedRights.includes(right);
};

userSchema.methods.addWarning = async function () {
  this.warningsCount += 1;
  if (this.warningsCount >= 3) this.isBlocked = true;
  return this.save();
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
