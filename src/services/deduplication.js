// src/services/deduplication.js

const crypto = require("crypto");
const { normalizeOrderId } = require("../utils/normalize");

module.exports = {
  getOrderHash({ platform, orderId, userId }) {
    const normId = normalizeOrderId(orderId);
    const base = `${platform.toLowerCase()}-${normId}-${userId || ""}`;
    return crypto.createHash("sha256").update(base).digest("hex");
  },
};
