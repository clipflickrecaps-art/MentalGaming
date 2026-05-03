/**
 * SystemStatus — singleton document storing bot-wide operational settings.
 *
 * Usage:
 *   const status = await SystemStatus.get();          // always returns the one document
 *   await SystemStatus.set({ maintenanceMode: true }); // partial update, auto-creates
 */

const mongoose = require('mongoose');

const SINGLETON_ID = 'global';

const systemStatusSchema = new mongoose.Schema(
  {
    _id: { type: String, default: SINGLETON_ID },

    // ── Maintenance Mode ───────────────────────────────────────────────────────
    maintenanceMode:    { type: Boolean, default: false },
    maintenanceSince:   { type: Date,    default: null },
    maintenanceUntil:   { type: Date,    default: null },
    maintenanceMessage: {
      type: String,
      default: '🔧 We are performing scheduled maintenance. We\'ll be back shortly!',
    },

    // ── Holiday Mode ───────────────────────────────────────────────────────────
    holidayMode:    { type: Boolean, default: false },
    holidayUntil:   { type: Date,    default: null },
    holidayMessage: {
      type: String,
      default: '🎉 We are on holiday! You can browse but orders and top-ups are temporarily disabled.',
    },

    // ── Meta ───────────────────────────────────────────────────────────────────
    updatedBy: { type: Number, default: null },
  },
  { timestamps: true, versionKey: false }
);

systemStatusSchema.statics.get = async function () {
  let doc = await this.findById(SINGLETON_ID);
  if (!doc) doc = await this.create({ _id: SINGLETON_ID });
  return doc;
};

systemStatusSchema.statics.set = async function (fields, updatedBy = null) {
  if (updatedBy) fields.updatedBy = updatedBy;
  return this.findByIdAndUpdate(
    SINGLETON_ID,
    { $set: fields },
    { upsert: true, new: true }
  );
};

module.exports = mongoose.model('SystemStatus', systemStatusSchema);
