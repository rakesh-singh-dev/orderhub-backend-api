// src/services/enhancedEmailParser.js - FOCUSED ON ACCURATE DATA EXTRACTION

const cheerio = require("cheerio");
const { normalizeOrderId, normalizeText } = require("../utils/normalize");
const logger = require("../utils/logger").createModuleLogger(
  "EnhancedEmailParser"
);

// Enhanced platform configurations with better patterns
const enhancedPlatforms = [
  {
    name: "amazon",
    displayName: "Amazon",
    senderPatterns: [
      "amazon.in",
      "amazon.com",
      "amazonsesdelivery",
      "auto-confirm@amazon",
    ],
    subjectPatterns: [
      "your order",
      "shipped",
      "delivered",
      "order confirmation",
      "your package",
      "shipment",
    ],

    // Multiple order ID patterns for better matching
    orderIdPatterns: [
      /Order\s*#?\s*([0-9]{3}-[0-9]{7,8}-[0-9]{7,8})/gi,
      /Order\s*ID[:\s]*([0-9]{3}-[0-9]{7,8}-[0-9]{7,8})/gi,
      /([0-9]{3}-[0-9]{7,8}-[0-9]{7,8})/g,
    ],

    // Enhanced amount extraction
    amountPatterns: [
      /Total[:\s]*₹\s*([\d,]+\.?\d*)/gi,
      /Order\s*Total[:\s]*₹\s*([\d,]+\.?\d*)/gi,
      /Grand\s*Total[:\s]*₹\s*([\d,]+\.?\d*)/gi,
      /₹\s*([\d,]+\.?\d*)/g,
    ],

    // Product name extraction - multiple approaches
    productPatterns: [
      // From links
      /<a[^>]*href[^>]*dp\/[^>]*>([^<]{15,150})<\/a>/gi,
      /<a[^>]*href[^>]*>([^<]{20,100})<\/a>/gi,
      // From product sections
      /Product[:\s]*(.{15,100})\s*(?:Quantity|₹)/gi,
      /Item[:\s]*(.{15,100})\s*(?:Quantity|₹)/gi,
      // From structured data
      /([A-Za-z][^₹\n]{20,120})\s*Quantity:\s*\d+/gi,
    ],

    // Status detection keywords
    statusKeywords: {
      delivered: ["delivered", "successfully delivered", "package delivered"],
      shipped: ["shipped", "dispatched", "on the way", "in transit"],
      confirmed: ["confirmed", "order placed", "order confirmed"],
      cancelled: ["cancelled", "canceled", "refund initiated"],
      processing: ["preparing", "packing", "processing"],
    },

    // Address patterns
    addressPatterns: [
      /(?:Delivery Address|Shipping Address|Ship to)[:\s]*([^\n\r]{10,200})/gi,
      /Address[:\s]*([^\n\r]{10,200})/gi,
    ],

    // Tracking patterns
    trackingPatterns: [
      /Tracking\s*(?:ID|Number)[:\s]*([A-Z0-9]{8,25})/gi,
      /AWB[:\s]*([A-Z0-9]{8,25})/gi,
      /Shipment\s*ID[:\s]*([A-Z0-9]{8,25})/gi,
    ],

    // Delivery date patterns
    deliveryDatePatterns: [
      /Arriving\s+(.+?)(?=\s|$|\n)/gi,
      /Expected\s+by\s+(.+?)(?=\s|$|\n)/gi,
      /Delivery\s+by\s+(.+?)(?=\s|$|\n)/gi,
      /will\s+arrive\s+(.+?)(?=\s|$|\n)/gi,
    ],
  },

  {
    name: "flipkart",
    displayName: "Flipkart",
    senderPatterns: ["flipkart.com", "fkrt.it", "flipkart"],
    subjectPatterns: [
      "shipped",
      "delivered",
      "item from your order",
      "order update",
      "your order",
    ],

    orderIdPatterns: [
      /Order\s*ID[:\s]*([A-Z]{2}[0-9]{15,25})/gi,
      /Order[:\s]*([A-Z]{2}[0-9]{15,25})/gi,
      /([A-Z]{2}[0-9]{15,25})/g,
    ],

    amountPatterns: [
      /₨\.\s*([\d,]+\.?\d*)/g,
      /Rs\.\s*([\d,]+\.?\d*)/g,
      /Item\s*total[:\s]*₨\.\s*([\d,]+\.?\d*)/gi,
      /Shipment\s*total[:\s]*₨\.\s*([\d,]+\.?\d*)/gi,
    ],

    productPatterns: [
      /([A-Za-z][^₨\n\r]{15,150})\s*(?:Seller|Qty)/gi,
      /<a[^>]*>([^<]{15,120})<\/a>/gi,
      /([A-Za-z][^₨\n\r]{20,100})(?=\s*Seller[:\s]*)/gi,
    ],

    statusKeywords: {
      delivered: ["delivered"],
      shipped: ["shipped", "dispatched", "out for delivery"],
      confirmed: ["confirmed", "order placed"],
    },

    addressPatterns: [/Delivery\s*Address[:\s]*([^\n\r]{10,200})/gi],

    deliveryDatePatterns: [
      /Delivery\s+by\s+(.+?)(?=\s|$|\n)/gi,
      /Expected\s+delivery\s+(.+?)(?=\s|$|\n)/gi,
    ],
  },
];

class EnhancedEmailParser {
  /**
   * Main parse method - enhanced data extraction
   */
  parseEmail({ from, subject, html, text }) {
    try {
      const content = this.prepareContent(html, text);

      // 1. Detect platform using enhanced logic
      const platformConfig = this.detectPlatform({ from, subject });
      if (!platformConfig) {
        logger.debug("No platform detected", {
          from: from?.substring(0, 30),
          subject: subject?.substring(0, 50),
        });
        return null;
      }

      logger.info(`Platform detected: ${platformConfig.name}`, {
        from: from?.substring(0, 30),
      });

      // 2. Extract core data with enhanced patterns
      const extractedData = this.extractAllData(content, platformConfig);

      if (!extractedData.orderId) {
        logger.debug(`No order ID found for ${platformConfig.name}`);
        return null;
      }

      // 3. Enhanced item extraction for each platform
      let items = [];
      if (platformConfig.name === "amazon") {
        items = this.extractAmazonItems(content, html);
      } else if (platformConfig.name === "flipkart") {
        items = this.extractFlipkartItems(content, html);
      }

      // 4. Build final result in your current format
      const result = {
        platform: platformConfig.name,
        orderId: normalizeOrderId(extractedData.orderId),
        totalAmount: extractedData.totalAmount,
        items: items,
        status: extractedData.status || "ordered",
        deliveryEta: extractedData.deliveryEta,
        deliveryAddress: extractedData.deliveryAddress,
        trackingId: extractedData.trackingId,
        raw: { from, subject }, // For debugging
      };

      logger.info(`Order parsed successfully`, {
        platform: result.platform,
        orderId: result.orderId,
        itemsCount: items.length,
        amount: result.totalAmount,
      });

      return result;
    } catch (error) {
      logger.error("Email parsing error:", {
        error: error.message,
        from,
        subject,
      });
      return null;
    }
  }

  /**
   * Enhanced platform detection
   */
  detectPlatform({ from, subject }) {
    const fromLower = (from || "").toLowerCase();
    const subjectLower = (subject || "").toLowerCase();

    for (const platform of enhancedPlatforms) {
      // Check sender patterns
      const senderMatch = platform.senderPatterns.some((pattern) =>
        fromLower.includes(pattern.toLowerCase())
      );

      // Check subject patterns
      const subjectMatch = platform.subjectPatterns.some((pattern) =>
        subjectLower.includes(pattern.toLowerCase())
      );

      // Platform detected if both match or strong sender match
      if (
        (senderMatch && subjectMatch) ||
        (senderMatch &&
          platform.senderPatterns.some(
            (p) =>
              fromLower.includes(p.toLowerCase()) &&
              (p.includes("amazon") || p.includes("flipkart"))
          ))
      ) {
        return platform;
      }
    }

    return null;
  }

  /**
   * Prepare content from HTML/text
   */
  prepareContent(html, text) {
    let content = "";

    if (html) {
      const $ = cheerio.load(html);
      // Remove scripts, styles but keep structure
      $("script, style, noscript").remove();
      content = $("body").length ? $("body").text() : $.text();

      // Also preserve some HTML structure for better parsing
      content += "\n\nHTML_CONTENT:\n" + html;
    }

    if (!content && text) {
      content = text;
    }

    // Clean up content
    return content
      .replace(/\s+/g, " ")
      .replace(/[\r\n]+/g, "\n")
      .trim();
  }

  /**
   * Extract all data using multiple patterns
   */
  extractAllData(content, platformConfig) {
    const data = {};

    // Extract Order ID using multiple patterns
    data.orderId = this.extractWithPatterns(
      content,
      platformConfig.orderIdPatterns
    );

    // Extract Amount
    const amountStr = this.extractWithPatterns(
      content,
      platformConfig.amountPatterns
    );
    if (amountStr) {
      data.totalAmount = parseFloat(amountStr.replace(/[,\s]/g, ""));
    }

    // Extract Product Name
    data.productName = this.extractWithPatterns(
      content,
      platformConfig.productPatterns
    );
    if (data.productName) {
      data.productName = normalizeText(data.productName)
        .replace(/[₹$£€]\s*[\d,.]*/g, "") // Remove prices
        .substring(0, 200)
        .trim();
    }

    // Detect Status
    data.status = this.detectStatus(content, platformConfig.statusKeywords);

    // Extract Delivery Address
    data.deliveryAddress = this.extractWithPatterns(
      content,
      platformConfig.addressPatterns
    );
    if (data.deliveryAddress) {
      data.deliveryAddress = normalizeText(data.deliveryAddress).substring(
        0,
        300
      );
    }

    // Extract Tracking ID
    data.trackingId = this.extractWithPatterns(
      content,
      platformConfig.trackingPatterns
    );

    // Extract Delivery Date/ETA
    const deliveryStr = this.extractWithPatterns(
      content,
      platformConfig.deliveryDatePatterns
    );
    if (deliveryStr) {
      data.deliveryEta = this.parseDate(deliveryStr);
    }

    return data;
  }

  /**
   * Extract using multiple patterns with fallback
   */
  extractWithPatterns(content, patterns) {
    if (!patterns || !Array.isArray(patterns)) return null;

    for (const pattern of patterns) {
      const matches = content.match(pattern);
      if (matches && matches.length > 1) {
        // Return first non-empty capture group
        for (let i = 1; i < matches.length; i++) {
          if (matches[i] && matches[i].trim()) {
            return matches[i].trim();
          }
        }
      }
    }
    return null;
  }

  /**
   * Detect status from content
   */
  detectStatus(content, statusKeywords) {
    const contentLower = content.toLowerCase();

    // Check in priority order (most specific first)
    const statusOrder = [
      "delivered",
      "shipped",
      "cancelled",
      "confirmed",
      "processing",
    ];

    for (const status of statusOrder) {
      const keywords = statusKeywords[status] || [];
      if (
        keywords.some((keyword) => contentLower.includes(keyword.toLowerCase()))
      ) {
        return status;
      }
    }

    return "ordered"; // Default status
  }

  /**
   * Enhanced Amazon item extraction
   */
  extractAmazonItems(content, html) {
    const items = [];

    try {
      // Method 1: Extract from HTML structure
      if (html) {
        const $ = cheerio.load(html);

        // Look for product links and quantity patterns
        $("a").each((_, el) => {
          const linkText = $(el).text().trim();
          const href = $(el).attr("href");

          if (href && href.includes("/dp/") && linkText.length > 15) {
            // Look for quantity and price near this product link
            const parent = $(el).parent();
            const nearbyText = parent.text();

            const quantityMatch = nearbyText.match(/Quantity[:\s]*(\d+)/i);
            const priceMatch = nearbyText.match(/₹\s*([\d,]+\.?\d*)/);

            items.push({
              name: linkText.substring(0, 150),
              quantity: quantityMatch ? parseInt(quantityMatch[1]) : 1,
              price: priceMatch
                ? parseFloat(priceMatch[1].replace(/,/g, ""))
                : null,
            });
          }
        });
      }

      // Method 2: Text-based extraction for items with quantity and price
      const itemPatterns = [
        /([A-Za-z][^₹\n]{15,120})\s*Quantity:\s*(\d+)\s*₹\s*([\d,]+\.?\d*)/gi,
        /([A-Za-z][^₹\n]{15,120})\s*Qty[:\s]*(\d+)\s*₹\s*([\d,]+\.?\d*)/gi,
      ];

      for (const pattern of itemPatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const name = normalizeText(match[1])
            .replace(/[₹$£€]\s*[\d,.]*/g, "")
            .trim();
          if (name.length >= 10) {
            items.push({
              name: name.substring(0, 150),
              quantity: parseInt(match[2]) || 1,
              price: parseFloat(match[3].replace(/,/g, "")) || null,
            });
          }
        }
        // Reset regex
        pattern.lastIndex = 0;
      }

      // Method 3: Fallback - extract product names from content
      if (items.length === 0) {
        const productMatch = content.match(
          /([A-Za-z][^₹\n]{20,150})\s*(?:Quantity|Arriving)/i
        );
        if (productMatch) {
          const name = normalizeText(productMatch[1]).trim();
          if (name.length >= 10) {
            items.push({
              name: name.substring(0, 150),
              quantity: 1,
              price: null,
            });
          }
        }
      }
    } catch (error) {
      logger.error("Error extracting Amazon items:", error);
    }

    // Remove duplicates and clean up
    return this.cleanupItems(items).slice(0, 5); // Max 5 items
  }

  /**
   * Enhanced Flipkart item extraction
   */
  extractFlipkartItems(content, html) {
    const items = [];

    try {
      // Method 1: Extract from HTML links
      if (html) {
        const $ = cheerio.load(html);

        $("a").each((_, el) => {
          const linkText = $(el).text().trim();
          const href = $(el).attr("href");

          if (linkText.length > 15 && linkText.length < 150) {
            // Look for seller info nearby to confirm this is a product
            const parent = $(el).closest("table, div");
            const nearbyText = parent.text();

            if (nearbyText.includes("Seller") || nearbyText.includes("Qty")) {
              const quantityMatch = nearbyText.match(/Qty[:\s]*(\d+)/i);
              const priceMatch = nearbyText.match(/₨\.\s*([\d,]+\.?\d*)/);

              items.push({
                name: linkText,
                quantity: quantityMatch ? parseInt(quantityMatch[1]) : 1,
                price: priceMatch
                  ? parseFloat(priceMatch[1].replace(/,/g, ""))
                  : null,
              });
            }
          }
        });
      }

      // Method 2: Text-based extraction
      const itemPatterns = [
        /([A-Za-z][^₨\n]{15,150})\s*Seller[:\s]*[^\n]*\s*Qty[:\s]*(\d+)/gi,
        /([A-Za-z][^₨\n]{15,150})\s*Qty[:\s]*(\d+)/gi,
      ];

      for (const pattern of itemPatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const name = normalizeText(match[1])
            .replace(/[₨$£€]\s*[\d,.]*/g, "")
            .trim();
          if (name.length >= 10) {
            items.push({
              name: name.substring(0, 150),
              quantity: parseInt(match[2]) || 1,
              price: null,
            });
          }
        }
        pattern.lastIndex = 0;
      }

      // Method 3: Extract from structured sections
      const sections = content.split(/\n+/);
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        if (
          section.includes("Seller") &&
          section.length > 20 &&
          section.length < 200
        ) {
          const nameMatch = section.match(/([A-Za-z][^₨\n]{15,120})/);
          if (nameMatch) {
            const name = normalizeText(nameMatch[1]).trim();
            if (name.length >= 10) {
              items.push({
                name: name.substring(0, 150),
                quantity: 1,
                price: null,
              });
            }
          }
        }
      }
    } catch (error) {
      logger.error("Error extracting Flipkart items:", error);
    }

    return this.cleanupItems(items).slice(0, 5);
  }

  /**
   * Clean up and deduplicate items
   */
  cleanupItems(items) {
    const seen = new Set();
    const cleaned = [];

    for (const item of items) {
      if (!item.name || item.name.length < 10) continue;

      // Create a normalized version for deduplication
      const normalized = item.name
        .toLowerCase()
        .replace(/[^\w\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();

      if (!seen.has(normalized)) {
        seen.add(normalized);
        cleaned.push({
          name: item.name,
          quantity: item.quantity || 1,
          price: item.price || 0.0,
        });
      }
    }

    return cleaned;
  }

  /**
   * Parse date strings into Date objects
   */
  parseDate(dateStr) {
    if (!dateStr) return null;

    try {
      // Handle relative dates
      const lower = dateStr.toLowerCase();
      const today = new Date();

      if (lower.includes("today")) return today;
      if (lower.includes("tomorrow")) {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow;
      }

      // Handle day names
      const days = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ];
      for (let i = 0; i < days.length; i++) {
        if (lower.includes(days[i])) {
          const targetDay = new Date(today);
          const currentDay = today.getDay();
          const daysUntilTarget = (i - currentDay + 7) % 7;
          if (daysUntilTarget === 0 && lower.includes("next")) {
            targetDay.setDate(targetDay.getDate() + 7);
          } else {
            targetDay.setDate(targetDay.getDate() + daysUntilTarget);
          }
          return targetDay;
        }
      }

      // Try to parse as regular date
      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    } catch (error) {
      logger.debug("Date parsing failed:", { dateStr, error: error.message });
    }

    return null;
  }
}

module.exports = {
  parseEmail: (emailData) => {
    const parser = new EnhancedEmailParser();
    return parser.parseEmail(emailData);
  },
};
