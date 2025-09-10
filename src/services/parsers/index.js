// src/services/parsers/index.js - ENHANCED PARSER FACTORY
// Ensures your enhanced parsers are properly used

const AmazonParser = require("./amazonParser");
const FlipkartParser = require("./flipkartParser");
const SwiggyParser = require("./swiggyParser");
const MyntraParser = require("./myntraParser");
const BlinkitParser = require("./blinkitParser");
const GenericParser = require("./genericParser");

class ParserFactory {
  constructor() {
    // Initialize all parsers
    this.parsers = {
      amazon: new AmazonParser(),
      flipkart: new FlipkartParser(),
      swiggy: new SwiggyParser(),
      myntra: new MyntraParser(),
      blinkit: new BlinkitParser(),
      generic: new GenericParser(),
    };
  }

  /**
   * 🎯 ENHANCED: Parse email with better platform detection and debugging
   */
  parseEmail(emailData) {
    console.log("\n🔧 PARSER FACTORY: Starting email parsing...");
    console.log(`📧 From: ${emailData.from}`);
    console.log(`📧 Subject: ${emailData.subject?.substring(0, 60)}...`);

    try {
      // Step 1: Detect platform with enhanced logic
      const platform = this.detectPlatform(emailData);

      if (!platform) {
        console.log("❌ PARSER: No platform detected");
        return null;
      }

      console.log(`✅ PARSER: Platform detected - ${platform}`);

      // Step 2: Get appropriate parser
      const parser = this.parsers[platform];

      if (!parser) {
        console.log(`❌ PARSER: No parser available for platform ${platform}`);
        return this.parsers.generic.parse(emailData);
      }

      // Step 3: Verify parser can handle this email
      if (
        parser.constructor.canParse &&
        !parser.constructor.canParse(emailData)
      ) {
        console.log(`❌ PARSER: ${platform} parser cannot handle this email`);
        return null;
      }

      console.log(`🚀 PARSER: Using ${platform} parser...`);

      // Step 4: Parse with the specific parser
      const result = parser.parse(emailData);

      if (!result) {
        console.log(`❌ PARSER: ${platform} parser returned null`);
        return null;
      }

      // Step 5: Validate and enhance result
      const enhancedResult = this.enhanceParseResult(
        result,
        emailData,
        platform
      );

      console.log(`✅ PARSER: Successfully parsed ${platform} order`);
      console.log(`📊 PARSER RESULT:`, {
        platform: enhancedResult.platform,
        orderId: enhancedResult.orderId,
        amount: enhancedResult.amount,
        itemsCount: enhancedResult.products?.length || 0,
        confidence: enhancedResult.confidence,
      });

      return enhancedResult;
    } catch (error) {
      console.error("❌ PARSER FACTORY ERROR:", error.message);
      return null;
    }
  }

  /**
   * ENHANCED: Detect platform from email with STRICTER filtering
   */
  detectPlatform(emailData) {
    const from = (emailData.from || "").toLowerCase();
    const subject = (emailData.subject || "").toLowerCase();
    const content = (emailData.html || emailData.text || "").toLowerCase();

    // Enhanced platform detection with multiple indicators
    const platformIndicators = {
      amazon: [
        "amazon.in",
        "amazon.com",
        "@amazon",
        "auto-confirm@amazon",
        "shipment-tracking@amazon",
        "amazon.in order",
        "order-update@amazon",
      ],
      flipkart: ["flipkart.com", "@flipkart", "flipkart"],
      swiggy: ["swiggy.in", "@swiggy", "swiggy", "instamart"],
      myntra: ["myntra.com", "@myntra", "myntra"],
      blinkit: ["blinkit.com", "@blinkit", "blinkit"],
    };

    // Check each platform
    for (const [platform, indicators] of Object.entries(platformIndicators)) {
      const hasIndicator = indicators.some(
        (indicator) =>
          from.includes(indicator) ||
          subject.includes(indicator) ||
          content.includes(indicator)
      );

      if (hasIndicator) {
        console.log(
          `🎯 PARSER: Platform detected as ${platform} from indicators:`,
          indicators.filter((i) => from.includes(i) || subject.includes(i))
        );
        return platform;
      }
    }

    // ENHANCED: STRICT generic detection - only for emails with ORDER IDs
    console.log(
      "⚠️ PARSER: No specific platform detected, checking if valid order email..."
    );

    // Must have actual order ID patterns to be considered generic order
    const orderIdPatterns = [
      /\b\d{3}-\d{7,8}-\d{7,8}\b/, // Amazon format
      /\bOD\d{15,21}\b/, // Flipkart format
      /\b\d{12,18}\b/, // Long number IDs
      /\b[A-Z]{2,4}\d{10,20}\b/, // Letter+number combinations
    ];

    const hasOrderId = orderIdPatterns.some(
      (pattern) => pattern.test(content) || pattern.test(subject)
    );

    if (!hasOrderId) {
      console.log("❌ PARSER: No order ID patterns found - rejecting email");
      console.log(`📧 From: ${emailData.from?.substring(0, 50)}`);
      console.log(`📧 Subject: ${emailData.subject?.substring(0, 50)}`);
      return null;
    }

    // Additional validation - must be order-related
    const orderKeywords = [
      "order",
      "shipped",
      "delivered",
      "confirmation",
      "receipt",
      "payment",
    ];
    const hasOrderKeyword = orderKeywords.some(
      (keyword) => subject.includes(keyword) || content.includes(keyword)
    );

    if (!hasOrderKeyword) {
      console.log("❌ PARSER: No order keywords found - rejecting email");
      return null;
    }

    console.log(
      "🔍 PARSER: Using generic parser for order email with ID patterns"
    );
    return "generic";
  }

  /**
   * Enhance parse result with additional metadata
   */
  enhanceParseResult(result, emailData, platform) {
    // Ensure required fields exist
    const enhanced = {
      platform: result.platform || platform,
      orderId: result.orderId || result.order_id || null,
      amount: result.amount || result.totalAmount || 0,
      formattedAmount: result.formattedAmount || `₹${result.amount || 0}`,
      products: result.products || result.items || [],
      orderDate: result.orderDate || new Date(emailData.date || Date.now()),
      status: result.status || "unknown",
      confidence: result.confidence || 70,
      extractedAt: new Date().toISOString(),
      emailMetadata: {
        messageId: emailData.messageId,
        subject: emailData.subject,
        from: emailData.from,
        receivedAt: emailData.date,
      },
    };

    // Ensure products have required fields
    enhanced.products = enhanced.products.map((product) => ({
      name: product.name || "Unknown Product",
      quantity: product.quantity || 1,
      price: product.price || product.unit_price || 0,
      formattedPrice: product.formattedPrice || `₹${product.price || 0}`,
      type: product.type || "item",
    }));

    return enhanced;
  }

  /**
   * Get all available platforms
   */
  getAvailablePlatforms() {
    return Object.keys(this.parsers);
  }

  /**
   * Check if a platform is supported
   */
  isPlatformSupported(platform) {
    return this.parsers.hasOwnProperty(platform);
  }
}

// Export singleton instance
const parserFactory = new ParserFactory();

module.exports = {
  parserFactory,
  ParserFactory,
};
