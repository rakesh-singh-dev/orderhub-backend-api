// src/config/parserConfig.js - UPDATED: Removed quick delivery apps

const fs = require("fs");
const path = require("path");

/**
 * Auto-generate parser configuration based on discovered parsers
 * Updated to exclude quick delivery platforms (Swiggy, Blinkit, Zepto)
 */
class ParserConfig {
  constructor() {
    this.parsersDir = path.join(__dirname, "../services/parsers");
    this.config = this.generateConfig();
  }

  /**
   * Auto-generate configuration from parser files (excluding quick delivery)
   */
  generateConfig() {
    const config = {
      platforms: [],
      platformConfigs: {},
      emailPatterns: {},
      searchQueries: {},
    };

    try {
      const files = fs.readdirSync(this.parsersDir);

      // Exclude quick delivery app parsers
      const excludedParsers = [
        "swiggyParser.js",
        "blinkitParser.js",
        "zetpoParser.js",
      ];

      files.forEach((file) => {
        if (
          file === "index.js" ||
          file === "baseParser.js" ||
          !file.endsWith(".js") ||
          excludedParsers.includes(file)
        ) {
          return;
        }

        const platformMatch = file.match(/^(.+)Parser\.js$/);
        if (!platformMatch) return;

        const platform = platformMatch[1].toLowerCase();

        // Skip quick delivery platforms
        if (["swiggy", "blinkit", "zepto"].includes(platform)) {
          console.log(`⏭️ Skipping quick delivery platform: ${platform}`);
          return;
        }

        // Add to platforms list
        config.platforms.push(platform);

        // Generate default configuration for this platform
        config.platformConfigs[platform] =
          this.generatePlatformConfig(platform);
      });

      // Generate email patterns and search queries after all platform configs are created
      config.platforms.forEach((platform) => {
        config.emailPatterns[platform] = this.generateEmailPatterns(
          platform,
          config.platformConfigs[platform]
        );
        config.searchQueries[platform] = this.generateSearchQueries(
          platform,
          config.platformConfigs[platform]
        );
      });

      console.log(
        `📧 Auto-generated config for ${config.platforms.length} e-commerce platforms (excluded quick delivery)`
      );
    } catch (error) {
      console.error("❌ Error generating parser config:", error.message);
    }

    return config;
  }

  /**
   * Generate default configuration for a platform (e-commerce focused)
   */
  generatePlatformConfig(platform) {
    const configs = {
      amazon: {
        displayName: "Amazon",
        senderPatterns: ["amazon.in", "amazon.com", "@amazon"],
        subjectPatterns: [
          "shipped",
          "delivered",
          "dispatched",
          "your order",
          "order confirmation",
        ],
        orderIdPatterns: [/\b\d{3}-\d{7,8}-\d{7,8}\b/],
        amountPatterns: [
          /Order Total[^₹Rs\d]*(?:₹|Rs\.?)\s*([\d,.]+)/i,
          /Total[^₹Rs\d]*(?:₹|Rs\.?)\s*([\d,.]+)/i,
        ],
        statusKeywords: {
          delivered: ["delivered", "successfully delivered"],
          shipped: ["shipped", "dispatched"],
          confirmed: ["confirmed", "order placed"],
        },
      },
      flipkart: {
        displayName: "Flipkart",
        senderPatterns: ["flipkart.com", "nct.flipkart.com"],
        subjectPatterns: [
          "your order",
          "order confirmation",
          "shipped",
          "delivered",
        ],
        orderIdPatterns: [/Order ID\s*([A-Z0-9]+)/i],
        amountPatterns: [/Amount Paid[:\s]*₹\s*([\d,]+)/i],
        statusKeywords: {
          delivered: ["delivered"],
          shipped: ["shipped", "out for delivery"],
          confirmed: ["confirmed", "order placed"],
        },
      },
      myntra: {
        displayName: "Myntra",
        senderPatterns: ["myntra.com", "@myntra"],
        subjectPatterns: [
          "order confirmation",
          "order placed",
          "myntra",
          "shipped",
          "delivered",
        ],
        orderIdPatterns: [/order\s*(?:id|number|#)\s*[:\-]?\s*([A-Z0-9\-]+)/i],
        amountPatterns: [
          /(?:total|amount|paid)\s*[:\-]?\s*₹?\s*(\d+(?:,\d+)*(?:\.\d{2})?)/i,
        ],
        statusKeywords: {
          delivered: ["delivered", "successfully delivered"],
          shipped: ["shipped", "dispatched"],
          confirmed: ["confirmed", "order placed"],
        },
      },
      nykaa: {
        displayName: "Nykaa",
        senderPatterns: [
          "nykaa.com",
          "@nykaa",
          "noreply@nykaa",
          "orders@nykaa",
        ],
        subjectPatterns: [
          "order confirmation",
          "order placed",
          "your order",
          "order shipped",
          "order delivered",
        ],
        orderIdPatterns: [/order\s*(?:id|number|#)\s*[:\-]?\s*([A-Z0-9\-]+)/i],
        amountPatterns: [
          /(?:total|amount|paid|grand total|order total)\s*[:\-]?\s*₹?\s*(\d+(?:,\d+)*(?:\.\d{2})?)/i,
        ],
        statusKeywords: {
          delivered: ["delivered", "successfully delivered"],
          shipped: ["shipped", "dispatched"],
          confirmed: ["confirmed", "order placed"],
        },
      },
      ajio: {
        displayName: "Ajio",
        senderPatterns: ["ajio.com", "@ajio", "noreply@ajio"],
        subjectPatterns: [
          "order confirmation",
          "order placed",
          "your order",
          "shipped",
          "delivered",
        ],
        orderIdPatterns: [/order\s*(?:id|number|#)\s*[:\-]?\s*([A-Z0-9\-]+)/i],
        amountPatterns: [
          /(?:total|amount|paid|grand total|order total)\s*[:\-]?\s*₹?\s*(\d+(?:,\d+)*(?:\.\d{2})?)/i,
        ],
        statusKeywords: {
          delivered: ["delivered", "successfully delivered"],
          shipped: ["shipped", "dispatched"],
          confirmed: ["confirmed", "order placed"],
        },
      },
      meesho: {
        displayName: "Meesho",
        senderPatterns: ["meesho.com", "@meesho", "noreply@meesho"],
        subjectPatterns: [
          "order confirmation",
          "order placed",
          "your order",
          "shipped",
          "delivered",
        ],
        orderIdPatterns: [/order\s*(?:id|number|#)\s*[:\-]?\s*([A-Z0-9\-]+)/i],
        amountPatterns: [
          /(?:total|amount|paid|grand total|order total)\s*[:\-]?\s*₹?\s*(\d+(?:,\d+)*(?:\.\d{2})?)/i,
        ],
        statusKeywords: {
          delivered: ["delivered", "successfully delivered"],
          shipped: ["shipped", "dispatched"],
          confirmed: ["confirmed", "order placed"],
        },
      },
      bigbasket: {
        displayName: "BigBasket",
        senderPatterns: ["bigbasket.com", "@bigbasket", "noreply@bigbasket"],
        subjectPatterns: [
          "order confirmation",
          "order placed",
          "your order",
          "shipped",
          "delivered",
        ],
        orderIdPatterns: [/order\s*(?:id|number|#)\s*[:\-]?\s*([A-Z0-9\-]+)/i],
        amountPatterns: [
          /(?:total|amount|paid|grand total|order total|bill amount)\s*[:\-]?\s*₹?\s*(\d+(?:,\d+)*(?:\.\d{2})?)/i,
        ],
        statusKeywords: {
          delivered: ["delivered", "successfully delivered"],
          shipped: ["shipped", "dispatched"],
          confirmed: ["confirmed", "order placed"],
        },
      },
      generic: {
        displayName: "Generic",
        senderPatterns: ["*"],
        subjectPatterns: ["order", "confirmation", "shipped", "delivered"],
        orderIdPatterns: [/order\s*(?:id|number|#)\s*[:\-]?\s*([A-Z0-9\-]+)/i],
        amountPatterns: [
          /(?:total|amount|paid|grand total|order total|final amount)\s*[:\-]?\s*₹?\s*(\d+(?:,\d+)*(?:\.\d{2})?)/i,
        ],
        statusKeywords: {
          delivered: ["delivered", "successfully delivered"],
          shipped: ["shipped", "dispatched"],
          confirmed: ["confirmed", "order placed"],
        },
      },
    };

    return (
      configs[platform] || {
        displayName: platform.charAt(0).toUpperCase() + platform.slice(1),
        senderPatterns: [`${platform}.com`, `@${platform}`],
        subjectPatterns: ["order", "confirmation", "shipped", "delivered"],
        orderIdPatterns: [/order\s*[:\-]?\s*([A-Z0-9\-]+)/i],
        amountPatterns: [
          /(?:total|amount)\s*[:\-]?\s*₹?\s*(\d+(?:,\d+)*(?:\.\d{2})?)/i,
        ],
        statusKeywords: {
          delivered: ["delivered"],
          shipped: ["shipped"],
          confirmed: ["confirmed"],
        },
      }
    );
  }

  /**
   * Generate email search patterns for a platform
   */
  generateEmailPatterns(platform, platformConfig) {
    return {
      from: platformConfig.senderPatterns.join(" OR "),
      subject: platformConfig.subjectPatterns.join(" OR "),
      keywords: [
        ...platformConfig.senderPatterns,
        ...platformConfig.subjectPatterns,
      ],
    };
  }

  /**
   * Generate search queries for a platform
   */
  generateSearchQueries(platform, platformConfig) {
    return {
      from: platformConfig.senderPatterns,
      subject: platformConfig.subjectPatterns,
      excludePromotions: true,
    };
  }

  /**
   * Get all supported platforms (e-commerce only)
   */
  getSupportedPlatforms() {
    return this.config.platforms.filter(
      (platform) => !["swiggy", "blinkit", "zepto"].includes(platform)
    );
  }

  /**
   * Get configuration for a specific platform
   */
  getPlatformConfig(platform) {
    // Block quick delivery platforms
    if (["swiggy", "blinkit", "zepto"].includes(platform.toLowerCase())) {
      console.log(
        `⚠️ Platform ${platform} not supported (quick delivery app excluded)`
      );
      return null;
    }
    return this.config.platformConfigs[platform.toLowerCase()];
  }

  /**
   * Get email patterns for a platform
   */
  getEmailPatterns(platform) {
    if (["swiggy", "blinkit", "zepto"].includes(platform.toLowerCase())) {
      return null;
    }
    return this.config.emailPatterns[platform.toLowerCase()];
  }

  /**
   * Get search queries for a platform
   */
  getSearchQueries(platform) {
    if (["swiggy", "blinkit", "zepto"].includes(platform.toLowerCase())) {
      return null;
    }
    return this.config.searchQueries[platform.toLowerCase()];
  }

  /**
   * Reload configuration (useful for development)
   */
  reload() {
    this.config = this.generateConfig();
    return this.config;
  }

  /**
   * Get full configuration (filtered for e-commerce only)
   */
  getConfig() {
    return {
      ...this.config,
      platforms: this.config.platforms.filter(
        (platform) => !["swiggy", "blinkit", "zepto"].includes(platform)
      ),
    };
  }
}

// Create singleton instance
const parserConfig = new ParserConfig();

module.exports = {
  ParserConfig,
  parserConfig,
  // Convenience methods
  getSupportedPlatforms: () => parserConfig.getSupportedPlatforms(),
  getPlatformConfig: (platform) => parserConfig.getPlatformConfig(platform),
  getEmailPatterns: (platform) => parserConfig.getEmailPatterns(platform),
  getSearchQueries: (platform) => parserConfig.getSearchQueries(platform),
  reload: () => parserConfig.reload(),
  getConfig: () => parserConfig.getConfig(),
};
