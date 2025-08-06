// src/services/emailParserFactory.js

const { parseEmail } = require("./emailParser");
const { getOrderHash } = require("./deduplication");

module.exports = {
  parseAndHash({ from, subject, html, text, userId }) {
    const parsed = parseEmail({ from, subject, html, text });
    if (!parsed || !parsed.orderId) return null;
    const hash = getOrderHash({
      platform: parsed.platform,
      orderId: parsed.orderId,
      userId,
    });
    return { ...parsed, hash };
  },
};
