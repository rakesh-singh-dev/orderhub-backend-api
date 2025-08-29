// src/services/parsers/genericParser.js - UPDATED: No quick delivery app detection

const BaseParser = require("./baseParser");

class GenericParser extends BaseParser {
  constructor() {
    super("generic");
  }

  /**
   * Generic parser should only return true as a last resort
   * Updated to exclude quick delivery platforms
   */
  canParse(email) {
    const { sender, subject } = email;
    const content = `${sender} ${subject}`.toLowerCase();

    // Explicitly reject quick delivery platforms
    const quickDeliveryPatterns = [
      "swiggy",
      "blinkit",
      "zepto",
      "instamart",
      "10 minute delivery",
      "quick delivery",
      "instant delivery",
      "dunzo",
      "shadowfax",
    ];

    const isQuickDelivery = quickDeliveryPatterns.some((pattern) =>
      content.includes(pattern)
    );

    if (isQuickDelivery) {
      console.log("❌ GENERIC PARSER: Rejecting quick delivery email");
      return false;
    }

    // Only attempt parsing if we have e-commerce order-related keywords
    const ecommerceOrderKeywords = [
      "order confirmation",
      "order placed",
      "shipped",
      "delivered",
      "payment",
      "invoice",
      "receipt",
      "purchase",
      "transaction",
    ];

    return ecommerceOrderKeywords.some((keyword) => content.includes(keyword));
  }

  /**
   * Parse generic e-commerce email (excluding quick delivery)
   */
  parse(email) {
    const html = email.html || "";
    const text = email.text || "";
    const subject = email.subject || "";
    const sender = email.sender || "";

    // Double-check: reject quick delivery content
    const content = (html + text + subject + sender).toLowerCase();
    const quickDeliveryIndicators = [
      "swiggy",
      "blinkit",
      "zepto",
      "instamart",
      "quick delivery",
      "instant delivery",
      "10 minute",
      "dunzo",
      "shadowfax",
    ];

    if (
      quickDeliveryIndicators.some((indicator) => content.includes(indicator))
    ) {
      console.log(
        "❌ GENERIC PARSER: Content contains quick delivery indicators - rejecting"
      );
      return null;
    }

    // E-commerce focused regex patterns
    const orderIdPatterns = [
      // More specific patterns for e-commerce (avoid short/garbage IDs)
      /order\s*(?:id|number|#)\s*[:\-]?\s*([A-Z0-9\-]{8,25})/i,
      /purchase\s*(?:id|number|#)\s*[:\-]?\s*([A-Z0-9\-]{8,25})/i,
      /transaction\s*(?:id|number|#)\s*[:\-]?\s*([A-Z0-9\-]{8,25})/i,
      /invoice\s*(?:id|number|#)\s*[:\-]?\s*([A-Z0-9\-]{8,25})/i,
      // Only match # followed by reasonable e-commerce order ID length
      /#([A-Z0-9\-]{8,25})/i,
    ];

    const amountPatterns = [
      // E-commerce focused amount patterns (higher minimum amounts)
      /(?:total|amount|paid|grand total|order total|final amount|invoice total)\s*[:\-]?\s*₹?\s*(\d+(?:,\d+)*(?:\.\d{2})?)/i,
      /₹\s*((?:[1-9]\d{2,}|[1-9]\d{3,})(?:,\d+)*(?:\.\d{2})?)/i, // Minimum ₹100+ for e-commerce
      /rs\.?\s*((?:[1-9]\d{2,}|[1-9]\d{3,})(?:,\d+)*(?:\.\d{2})?)/i,
    ];

    const datePatterns = [
      /(?:ordered|placed|purchased|booked)\s*on\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      /(?:order date|purchase date|date)\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    ];

    const orderId = this.extractOrderId(html, text, orderIdPatterns);
    const amount = this.extractAmount(html, text, amountPatterns);
    const orderDate = this.extractOrderDate(html, text, datePatterns);
    const items = this.extractItems(html, text);
    const orderStatus = this.extractOrderStatus(html, text, subject);
    const platform = this.detectPlatform(sender, subject);

    // Reject if platform is quick delivery
    if (["swiggy", "blinkit", "zepto"].includes(platform)) {
      console.log(
        `❌ GENERIC PARSER: Detected quick delivery platform ${platform} - rejecting`
      );
      return null;
    }

    return {
      orderId,
      amount,
      orderDate,
      items,
      status: orderStatus,
      platform: platform,
      confidence: this.calculateConfidence(orderId, amount, items),
    };
  }

  /**
   * Extract order ID using e-commerce focused patterns
   */
  extractOrderId(html, text, patterns) {
    const content = html + text;

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        const orderId = match[1].trim();

        // Enhanced validation for e-commerce order IDs
        if (this.isValidEcommerceOrderId(orderId)) {
          return orderId;
        }
      }
    }
    return null;
  }

  /**
   * Validate if order ID is suitable for e-commerce (not quick delivery)
   */
  isValidEcommerceOrderId(orderId) {
    if (!orderId || orderId.length < 5) return false;

    // Reject obviously invalid patterns
    const invalidPatterns = [
      /^(value|table|radius|ffffff|style|width|height|px|img|src|href|div|span)$/i,
      /^\d{1,6}$/, // Too short for e-commerce orders (likely food order numbers)
      /^[a-f0-9]{32,}$/i, // Hash-like strings
    ];

    return !invalidPatterns.some((pattern) => pattern.test(orderId));
  }

  /**
   * Extract order amount (higher minimum for e-commerce)
   */
  extractAmount(html, text, patterns) {
    const content = html + text;

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        const amountStr = match[1].replace(/,/g, "");
        const amount = parseFloat(amountStr);

        // Higher minimum amount for e-commerce (₹50+)
        if (!isNaN(amount) && amount >= 50 && amount < 1000000) {
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
   * Extract order items (e-commerce focused, higher price thresholds)
   */
  extractItems(html, text) {
    const items = [];
    const content = html + text;

    // E-commerce item patterns (avoid small food items)
    const itemPatterns = [
      /([^₹\n]{10,100}?)\s*₹\s*(\d+(?:,\d+)*(?:\.\d{2})?)/gi,
      /([^₹\n]{10,100}?)\s*-\s*₹\s*(\d+(?:,\d+)*(?:\.\d{2})?)/gi,
      /product[:\-]?\s*([^₹\n]{10,100}?)\s*₹\s*(\d+(?:,\d+)*(?:\.\d{2})?)/gi,
      /item[:\-]?\s*([^₹\n]{10,100}?)\s*₹\s*(\d+(?:,\d+)*(?:\.\d{2})?)/gi,
    ];

    for (const pattern of itemPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const itemName = this.cleanProductName(match[1]);
        const price = parseFloat(match[2].replace(/,/g, ""));

        // E-commerce validation: higher price threshold, longer names
        if (
          itemName.length >= 10 && // Longer names for e-commerce products
          price >= 50 && // Higher minimum price for e-commerce
          !this.isInvalidProductName(itemName)
        ) {
          items.push({
            name: itemName,
            price: price,
            quantity: 1,
          });
        }
      }
    }

    return this.deduplicateItems(items);
  }

  /**
   * Check if product name is invalid (includes quick delivery indicators)
   */
  isInvalidProductName(itemName) {
    const nameLower = itemName.toLowerCase();

    const invalidIndicators = [
      "total",
      "amount",
      "delivery",
      "tax",
      "discount",
      "subtotal",
      "grand total",
      // Quick delivery specific terms to reject
      "swiggy",
      "blinkit",
      "zepto",
      "instamart",
      "quick",
      "instant",
      "dunzo",
      "shadowfax",
      "10 minute",
      "delivered in",
    ];

    return invalidIndicators.some((indicator) => nameLower.includes(indicator));
  }

  /**
   * Extract order status (e-commerce focused)
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
      content.includes("on the way")
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
      content.includes("preparing")
    ) {
      return "processing";
    }

    return "ordered";
  }

  /**
   * Detect platform from sender and subject (e-commerce only)
   */
  detectPlatform(sender, subject) {
    const content = (sender + " " + subject).toLowerCase();

    // E-commerce platform patterns only
    const platformPatterns = {
      amazon: ["amazon", "amzn"],
      flipkart: ["flipkart", "nct.flipkart"],
      myntra: ["myntra"],
      nykaa: ["nykaa"],
      ajio: ["ajio"],
      meesho: ["meesho"],
      bigbasket: ["bigbasket", "big basket"],
      firstcry: ["firstcry", "first cry"],
      tatacliq: ["tatacliq", "tata cliq"],
      snapdeal: ["snapdeal"],
      paytmmall: ["paytmmall", "paytm mall"],
      reliancedigital: ["reliancedigital", "reliance digital"],
    };

    for (const [platform, patterns] of Object.entries(platformPatterns)) {
      for (const pattern of patterns) {
        if (content.includes(pattern)) {
          return platform;
        }
      }
    }

    return "generic";
  }

  /**
   * Calculate confidence score for parsed data
   * Generic parser has lower confidence for e-commerce
   */
  calculateConfidence(orderId, amount, items) {
    let confidence = 0.4; // Slightly higher base for e-commerce vs quick delivery

    if (orderId && orderId.length >= 8) confidence += 0.2;
    if (amount && amount >= 100) confidence += 0.2; // Higher amounts = more confidence
    if (items && items.length > 0) confidence += 0.1;

    return Math.min(confidence, 0.8); // Cap at 0.8 for generic parser
  }
}

module.exports = GenericParser;
