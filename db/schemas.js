"use strict";

const mongoose = require("mongoose");
const { Schema } = mongoose;

// ══════════════════════════════════════════════════
//  1. مخطط المستخدم (UserSchema)
// ══════════════════════════════════════════════════
const UserSchema = new Schema(
  {
    facebookId: { type: String, required: true, unique: true, index: true },
    name:       { type: String, default: "مستخدم", trim: true },
    money:      { type: Number, default: 0, min: 0 },
    xp:         { type: Number, default: 0, min: 0 },
    level:      { type: Number, default: 1, min: 1 },
    messageCount: { type: Number, default: 0 },
    role:       { type: Number, default: 0, enum: [0, 1, 2, 3, 4] },
    banned:     { type: Boolean, default: false },
    banReason:  { type: String, default: null },
    lastSeen:   { type: Date, default: Date.now },
  },
  { timestamps: true, collection: "users" }
);

UserSchema.methods.calculateLevel = function () {
  this.level = Math.floor(Math.sqrt(this.xp / 100)) + 1;
};

UserSchema.methods.addXP = async function (amount) {
  this.xp += amount;
  const newLevel = Math.floor(Math.sqrt(this.xp / 100)) + 1;
  const levelUp  = newLevel > this.level;
  this.level = newLevel;
  await this.save();
  return { levelUp, newLevel };
};

// ══════════════════════════════════════════════════
//  Exports
// ══════════════════════════════════════════════════
const UserModel  = mongoose.models.User  || mongoose.model("User",  UserSchema);

module.exports = { UserModel };
