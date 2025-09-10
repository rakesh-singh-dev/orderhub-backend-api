// src/services/parsers/dominosParser.js

const BaseParser = require("./baseParser");

class DominosParser extends BaseParser {
  constructor() {
    super("dominos");
  }

  /**
   * Check if this parser can handle the given email
   */
  canParse(email) {
    const sender = email.sender?.toLowerCase() || "";
    const subject = email.subject?.toLowerCase() || "";

    return (
      sender.includes("dominos") ||
      sender.includes("domino") ||
      sender.includes("dominos.com") ||
      sender.includes("@dominos") ||
      subject.includes("dominos") ||
      subject.includes("domino") ||
      subject.includes("pizza") ||
      subject.includes("order confirmation") ||
      subject.includes("order placed") ||
      subject.includes("your order")
    );
  }

  /**
   * Parse Domino's-specific email content
   */
  parse(email) {
    const html = email.html || "";
    const text = email.text || "";
    const subject = email.subject || "";

    // Domino's-specific regex patterns
    const orderIdPatterns = [
      /order\s*(?:id|number|#)\s*[:\-]?\s*([A-Z0-9\-]+)/i,
      /order\s*[:\-]?\s*([A-Z0-9\-]+)/i,
      /(?:order|order id)\s*[:\-]?\s*([A-Z0-9\-]+)/i,
      /#([A-Z0-9\-]+)/i,
    ];

    const amountPatterns = [
      /(?:total|amount|paid|grand total|order total|final amount)\s*[:\-]?\s*₹?\s*(\d+(?:,\d+)*(?:\.\d{2})?)/i,
      /₹\s*(\d+(?:,\d+)*(?:\.\d{2})?)/i,
      /rs\.?\s*(\d+(?:,\d+)*(?:\.\d{2})?)/i,
      /(\d+(?:,\d+)*(?:\.\d{2})?)\s*₹/i,
    ];

    const datePatterns = [
      /(?:ordered|placed|booked)\s*on\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      /(?:date|ordered)\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    ];

    const orderId = this.extractOrderId(html, text, orderIdPatterns);
    const amount = this.extractAmount(html, text, amountPatterns);
    const orderDate = this.extractOrderDate(html, text, datePatterns);
    const items = this.extractItems(html, text);
    const orderStatus = this.extractOrderStatus(html, text, subject);

    return {
      orderId,
      amount,
      orderDate,
      items,
      status: orderStatus,
      platform: "dominos",
      confidence: this.calculateConfidence(orderId, amount, items),
    };
  }

  /**
   * Extract order ID using multiple patterns
   */
  extractOrderId(html, text, patterns) {
    const content = html + text;

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        const orderId = match[1].trim();
        // Avoid returning placeholder values
        if (
          orderId &&
          orderId.length > 2 &&
          !orderId.toLowerCase().includes("value") &&
          !orderId.toLowerCase().includes("table")
        ) {
          return orderId;
        }
      }
    }
    return null;
  }

  /**
   * Extract order amount using multiple patterns
   */
  extractAmount(html, text, patterns) {
    const content = html + text;

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        const amountStr = match[1].replace(/,/g, "");
        const amount = parseFloat(amountStr);
        if (!isNaN(amount) && amount > 0 && amount < 1000000) {
          // Reasonable amount range
          return amount;
        }
      }
    }
    return null;
  }

  /**
   * Extract order date using multiple patterns
   */
  extractOrderDate(html, text, patterns) {
    const content = html + text;

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        const dateStr = match[1];
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }
    }
    return new Date();
  }

  /**
   * Extract order items using Domino's-specific patterns
   */
  extractItems(html, text) {
    const items = [];
    const content = html + text;

    // Domino's-specific item patterns
    const itemPatterns = [
      /([^₹\n]+?)\s*₹\s*(\d+(?:,\d+)*(?:\.\d{2})?)/gi,
      /([^₹\n]+?)\s*-\s*₹\s*(\d+(?:,\d+)*(?:\.\d{2})?)/gi,
      /([^₹\n]+?)\s*rs\.?\s*(\d+(?:,\d+)*(?:\.\d{2})?)/gi,
      /product[:\-]?\s*([^₹\n]+?)\s*₹\s*(\d+(?:,\d+)*(?:\.\d{2})?)/gi,
      /item[:\-]?\s*([^₹\n]+?)\s*₹\s*(\d+(?:,\d+)*(?:\.\d{2})?)/gi,
      // Pizza-specific patterns
      /(pizza[^₹\n]*?)\s*₹\s*(\d+(?:,\d+)*(?:\.\d{2})?)/gi,
      /(burger[^₹\n]*?)\s*₹\s*(\d+(?:,\d+)*(?:\.\d{2})?)/gi,
      /(pasta[^₹\n]*?)\s*₹\s*(\d+(?:,\d+)*(?:\.\d{2})?)/gi,
      /(beverage[^₹\n]*?)\s*₹\s*(\d+(?:,\d+)*(?:\.\d{2})?)/gi,
    ];

    for (const pattern of itemPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const itemName = this.cleanProductName(match[1]);
        const price = parseFloat(match[2].replace(/,/g, ""));

        // Skip if item name is too short or contains common non-product text
        if (
          itemName.length < 3 ||
          itemName.toLowerCase().includes("total") ||
          itemName.toLowerCase().includes("amount") ||
          itemName.toLowerCase().includes("delivery") ||
          itemName.toLowerCase().includes("tax") ||
          itemName.toLowerCase().includes("discount") ||
          itemName.toLowerCase().includes("subtotal") ||
          itemName.toLowerCase().includes("grand total")
        ) {
          continue;
        }

        items.push({
          name: itemName,
          price: price,
          quantity: 1,
        });
      }
    }

    return this.deduplicateItems(items);
  }

  /**
   * Extract order status using Domino's-specific patterns
   */
  extractOrderStatus(html, text, subject) {
    const content = (html + text + subject).toLowerCase();

    if (
      content.includes("delivered") ||
      content.includes("successfully delivered")
    ) {
      return "delivered";
    } else if (
      content.includes("out for delivery") ||
      content.includes("on the way") ||
      content.includes("out for delivery")
    ) {
      return "out_for_delivery";
    } else if (content.includes("shipped") || content.includes("dispatched")) {
      return "shipped";
    } else if (
      content.includes("confirmed") ||
      content.includes("order placed")
    ) {
      return "confirmed";
    } else if (
      content.includes("processing") ||
      content.includes("preparing") ||
      content.includes("baking")
    ) {
      return "processing";
    }

    return "ordered";
  }

  /**
   * Calculate confidence score for parsed data
   */
  calculateConfidence(orderId, amount, items) {
    let confidence = 0.4; // Base confidence for Domino's parser

    if (orderId) confidence += 0.2;
    if (amount && amount > 0) confidence += 0.2;
    if (items && items.length > 0) confidence += 0.1;

    return Math.min(confidence, 0.9); // Cap at 0.9 for Domino's parser
  }
}

module.exports = DominosParser; 