const { cleanHtml, extractTextContent } = require("../../utils/htmlCleaner");
const { extractAmount, formatAmount } = require("../../utils/amountExtractor");

class SwiggyParser {
  constructor() {
    this.platform = "swiggy";
  }

  /**
   * 🎯 ENHANCED: Parse Swiggy orders with CORRECT Grand Total extraction
   */
  parse(emailData) {
    console.log("🍔 Swiggy: Starting enhanced parsing...");
    console.log(`📧 Subject: ${emailData.subject}`);

    try {
      // Step 1: Clean HTML content
      const cleanContent = cleanHtml(emailData.html || emailData.text || "");
      console.log("✅ Swiggy: HTML cleaned successfully");

      // Step 2: Extract order ID
      const orderId = this.extractOrderId(cleanContent, emailData.subject);
      if (!orderId) {
        console.log("❌ Swiggy: No order ID found");
        return null;
      }
      console.log(`✅ Swiggy: Order ID found - ${orderId}`);

      // Step 3: Extract GRAND TOTAL (FIXED - not first item price)
      const grandTotal = this.extractGrandTotal(cleanContent);
      console.log(
        `💰 Swiggy: Grand Total extracted - ₹${grandTotal || "not found"}`
      );

      // Step 4: Extract individual items
      const items = this.extractItems(cleanContent);
      console.log(`📦 Swiggy: Items found - ${items.length} items`);

      // Step 5: Extract fees from Order Summary
      const fees = this.extractFees(cleanContent);
      console.log(`💳 Swiggy: Fees found - ${fees.length} fees`);

      // Step 6: Combine items and fees
      const allProducts = [...items, ...fees];

      // Step 7: Validate Grand Total vs sum of items
      const calculatedTotal = items.reduce(
        (sum, item) => sum + (item.price || 0),
        0
      );
      const feesTotal = fees.reduce((sum, fee) => sum + (fee.price || 0), 0);
      const expectedTotal = calculatedTotal + feesTotal;

      console.log(
        `🧮 Swiggy: Calculated total - Items: ₹${calculatedTotal} + Fees: ₹${feesTotal} = ₹${expectedTotal}`
      );
      console.log(`🎯 Swiggy: Extracted Grand Total: ₹${grandTotal}`);

      return {
        platform: this.platform,
        orderId,
        amount: grandTotal || expectedTotal || 0, // Use Grand Total, fallback to calculated
        formattedAmount: formatAmount(grandTotal || expectedTotal || 0),
        products: allProducts,
        orderDate: this.extractOrderDate(cleanContent, emailData.date),
        status: this.extractOrderStatus(cleanContent),
        deliveryInfo: this.extractDeliveryInfo(cleanContent),
        confidence: this.calculateConfidence(orderId, grandTotal, allProducts),
      };
    } catch (error) {
      console.error("❌ Swiggy parser error:", error);
      return null;
    }
  }

  /**
   * FIXED: Extract Grand Total from Order Summary section
   */
  extractGrandTotal(content) {
    console.log("💰 Swiggy: Looking for Grand Total...");

    // ENHANCED: Multiple patterns for Grand Total - prioritize these over item prices
    const grandTotalPatterns = [
      // Primary patterns - exact Grand Total
      /Grand\s*Total[:\s]*₹\s*([\d,]+(?:\.\d{2})?)/gi,
      /Grand\s*total[:\s]*₹\s*([\d,]+(?:\.\d{2})?)/gi,

      // Order Summary Total patterns
      /Total[:\s]*₹\s*([\d,]+(?:\.\d{2})?)/gi,
      /Order\s*Total[:\s]*₹\s*([\d,]+(?:\.\d{2})?)/gi,

      // Swiggy-specific patterns
      /Final\s*Amount[:\s]*₹\s*([\d,]+(?:\.\d{2})?)/gi,
      /Amount\s*to\s*Pay[:\s]*₹\s*([\d,]+(?:\.\d{2})?)/gi,

      // Last resort - look for amounts after "Total" word
      /Total.*?₹\s*([\d,]+(?:\.\d{2})?)/gi,
    ];

    // Try each pattern and collect all Grand Total candidates
    const grandTotalCandidates = [];

    for (const pattern of grandTotalPatterns) {
      const matches = [...content.matchAll(pattern)];
      for (const match of matches) {
        const amount = parseFloat(match[1].replace(/,/g, ""));
        if (!isNaN(amount) && amount > 0 && amount < 10000) {
          // Reasonable Swiggy order range
          grandTotalCandidates.push({
            amount,
            context: match[0],
            priority: this.getGrandTotalPriority(match[0]),
          });
        }
      }
    }

    if (grandTotalCandidates.length > 0) {
      // Sort by priority (highest first), then by amount (highest first for same priority)
      grandTotalCandidates.sort((a, b) => {
        if (a.priority !== b.priority) return b.priority - a.priority;
        return b.amount - a.amount;
      });

      const selected = grandTotalCandidates[0];
      console.log(
        `✅ Swiggy: Found Grand Total ₹${selected.amount} from context: "${selected.context}"`
      );
      console.log(
        `💡 Swiggy: All candidates:`,
        grandTotalCandidates.map((c) => `₹${c.amount} (${c.priority})`)
      );

      return selected.amount;
    }

    console.log("❌ Swiggy: No Grand Total found");
    return null;
  }

  /**
   * Get priority for Grand Total patterns
   */
  getGrandTotalPriority(context) {
    const contextLower = context.toLowerCase();

    if (contextLower.includes("grand total")) return 100;
    if (contextLower.includes("order total")) return 90;
    if (contextLower.includes("final amount")) return 85;
    if (contextLower.includes("amount to pay")) return 80;
    if (contextLower.includes("total")) return 70;

    return 50;
  }

  /**
   * Extract individual food items (separate from fees)
   */
  extractItems(content) {
    console.log("📦 Swiggy: Extracting food items...");

    const items = [];

    // Enhanced item patterns for Swiggy food orders
    const itemPatterns = [
      // Pattern: "1 x Classic Regular ₹340.00"
      /(\d+)\s*x\s*([^₹\n]{5,80}?)\s*₹\s*([\d,]+(?:\.\d{2})?)/gi,

      // Pattern: "Classic Regular (Qty: 1) ₹340.00"
      /([^(₹\n]{5,80}?)\s*\(Qty:\s*(\d+)\)\s*₹\s*([\d,]+(?:\.\d{2})?)/gi,

      // Pattern: "Product Name - ₹price"
      /([A-Z][^-₹\n]{5,60}?)\s*-\s*₹\s*([\d,]+(?:\.\d{2})?)/gi,
    ];

    for (const pattern of itemPatterns) {
      const matches = [...content.matchAll(pattern)];

      for (const match of matches) {
        let productName, quantity, price;

        if (match.length === 4) {
          // Pattern with quantity first
          quantity = parseInt(match[1]) || 1;
          productName = match[2].trim();
          price = parseFloat(match[3].replace(/,/g, ""));
        } else if (match.length === 4 && match[0].includes("Qty:")) {
          // Pattern with quantity in parentheses
          productName = match[1].trim();
          quantity = parseInt(match[2]) || 1;
          price = parseFloat(match[3].replace(/,/g, ""));
        } else {
          // Pattern without explicit quantity
          productName = match[1].trim();
          price = parseFloat(match[2].replace(/,/g, ""));
          quantity = 1;
        }

        // Validate as food item (not fee)
        if (this.isValidFoodItem(productName, price)) {
          items.push({
            name: this.cleanProductName(productName),
            quantity,
            price,
            formattedPrice: formatAmount(price),
            type: "item",
          });
          console.log(
            `✅ Swiggy item: ${productName} (${quantity}x) - ₹${price}`
          );
        }
      }
    }

    return items;
  }

  /**
   * Extract fees from Order Summary section
   */
  extractFees(content) {
    console.log("💳 Swiggy: Extracting fees...");

    const fees = [];

    // Fee patterns
    const feePatterns = [
      /([A-Za-z\s]+Fee)[:\s]*₹\s*([\d,]+(?:\.\d{2})?)/gi,
      /(Handling|Convenience|Delivery|Service|Platform)\s*Fee[:\s]*₹\s*([\d,]+(?:\.\d{2})?)/gi,
      /(GST|Tax|Charges)[:\s]*₹\s*([\d,]+(?:\.\d{2})?)/gi,
    ];

    for (const pattern of feePatterns) {
      const matches = [...content.matchAll(pattern)];

      for (const match of matches) {
        const feeName = match[1].trim();
        const feeAmount = parseFloat(match[2].replace(/,/g, ""));

        if (feeAmount >= 0 && feeAmount < 500) {
          // Reasonable fee range
          fees.push({
            name: feeName,
            quantity: 1,
            price: feeAmount,
            formattedPrice: formatAmount(feeAmount),
            type: "fee",
          });
          console.log(`✅ Swiggy fee: ${feeName} - ₹${feeAmount}`);
        }
      }
    }

    return fees;
  }

  /**
   * Validate if item is a food item (not a fee or garbage)
   */
  isValidFoodItem(name, price) {
    if (!name || name.length < 3) return false;
    if (price && (isNaN(price) || price < 1 || price > 5000)) return false;

    // Filter out fees and non-food items
    const nonFoodPatterns = [
      /fee$/i,
      /charge$/i,
      /tax$/i,
      /gst$/i,
      /total$/i,
      /summary$/i,
      /bill$/i,
      /^(handling|convenience|delivery|service|platform)/i,
    ];

    return !nonFoodPatterns.some((pattern) => pattern.test(name));
  }

  /**
   * Extract Swiggy order ID
   */
  extractOrderId(content, subject) {
    const orderIdPatterns = [
      // Swiggy order ID in subject: "Order ID: 123456789"
      /Order\s*ID[:\s]*(\d{8,15})/gi,

      // Order number patterns
      /Order\s*Number[:\s]*(\d{8,15})/gi,
      /Order[:\s]*#(\d{8,15})/gi,

      // Generic number pattern for Swiggy
      /(\d{10,15})/g,
    ];

    // Try subject first
    if (subject) {
      for (const pattern of orderIdPatterns.slice(0, 3)) {
        // Use specific patterns for subject
        const match = subject.match(pattern);
        if (match && this.isValidSwiggyOrderId(match[1])) {
          return match[1];
        }
      }
    }

    // Then try content
    for (const pattern of orderIdPatterns) {
      const matches = [...content.matchAll(pattern)];
      for (const match of matches) {
        if (this.isValidSwiggyOrderId(match[1])) {
          return match[1];
        }
      }
    }

    return null;
  }

  /**
   * Validate Swiggy order ID (FIXED: Accept longer IDs)
   */
  isValidSwiggyOrderId(orderId) {
    if (!orderId) return false;

    // FIXED: Swiggy order IDs can be 12-18 digits (your sample: 211890829491759 = 15 digits)
    return /^\d{10,18}$/.test(orderId) && orderId !== "0000000000";
  }

  /**
   * Extract delivery information
   */
  extractDeliveryInfo(content) {
    const addressPattern = /Delivery Address[:\s]*([^,\n]{10,100})/gi;
    const timePattern = /Delivery Time[:\s]*([^,\n]{5,50})/gi;

    const addressMatch = content.match(addressPattern);
    const timeMatch = content.match(timePattern);

    return {
      address: addressMatch
        ? addressMatch[0].replace(/^[^:]*:\s*/, "").trim()
        : null,
      time: timeMatch ? timeMatch[0].replace(/^[^:]*:\s*/, "").trim() : null,
    };
  }

  /**
   * Extract order date
   */
  extractOrderDate(content, emailDate) {
    const datePatterns = [
      /Order Date[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/gi,
      /Placed on[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/gi,
    ];

    for (const pattern of datePatterns) {
      const match = content.match(pattern);
      if (match) {
        return new Date(match[1]);
      }
    }

    return emailDate ? new Date(emailDate) : new Date();
  }

  /**
   * Extract order status
   */
  extractOrderStatus(content) {
    const statusPatterns = [
      /Status[:\s]*([^,\n]{5,30})/gi,
      /(confirmed|preparing|on the way|delivered|cancelled)/gi,
    ];

    for (const pattern of statusPatterns) {
      const match = content.match(pattern);
      if (match) {
        return match[1] || match[0];
      }
    }

    return "confirmed";
  }

  /**
   * Clean product name
   */
  cleanProductName(name) {
    return name
      .replace(/\s+/g, " ")
      .replace(/[<>]/g, "")
      .replace(/^\W+|\W+$/g, "")
      .trim();
  }

  /**
   * Calculate confidence score (FIXED: Clean decimal, no precision issues)
   */
  calculateConfidence(orderId, grandTotal, products) {
    let confidence = 0;

    if (orderId) confidence += 0.4; // 40%
    if (grandTotal && grandTotal > 0) confidence += 0.3; // 30%
    if (products && products.length > 0) confidence += 0.2; // 20%
    if (products && products.some((p) => p.price > 0)) confidence += 0.1; // 10%

    // FIXED: Round to avoid floating point precision issues
    return Math.round(Math.min(confidence, 1.0) * 100) / 100;
  }

  /**
   * FIXED: Check if email can be parsed - MORE INCLUSIVE for Swiggy orders
   */
  static canParse(emailData) {
    if (!emailData.from || !emailData.subject) return false;

    const from = emailData.from.toLowerCase();
    const subject = emailData.subject.toLowerCase();

    // Must be from Swiggy
    const isSwiggy =
      from.includes("swiggy.in") ||
      from.includes("@swiggy") ||
      from.includes("swiggy");

    if (!isSwiggy) {
      console.log(`❌ Swiggy canParse: Not from Swiggy - ${emailData.from}`);
      return false;
    }

    // ENHANCED: More inclusive order detection
    const orderIndicators = [
      "order",
      "delivered",
      "confirmed",
      "placed",
      "instamart",
      "gourmet",
      "food",
      "restaurant",
      "delivery",
      "dispatched",
    ];

    // Strict rejection patterns
    const rejectPatterns = [
      "newsletter",
      "promotional",
      "offer",
      "discount",
      "deals",
      "coupon",
      "marketing",
      "advertisement",
    ];

    const isDefinitelyNotOrder = rejectPatterns.some(
      (pattern) => subject.includes(pattern) || from.includes(pattern)
    );

    if (isDefinitelyNotOrder) {
      console.log(
        `❌ Swiggy canParse: Rejected promotional email - ${subject}`
      );
      return false;
    }

    const hasOrderKeyword = orderIndicators.some(
      (keyword) => subject.includes(keyword) || from.includes(keyword)
    );

    if (hasOrderKeyword) {
      console.log(`✅ Swiggy canParse: Accepted order email - ${subject}`);
    } else {
      console.log(`❌ Swiggy canParse: No order indicators - ${subject}`);
    }

    return hasOrderKeyword;
  }
}

module.exports = SwiggyParser;
