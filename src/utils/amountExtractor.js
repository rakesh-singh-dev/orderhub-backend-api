// src/utils/amountExtractor.js - COMPLETE ENHANCED VERSION FOR ALL PLATFORMS

/**
 * 💰 Enhanced Amount Extractor - Handles all currency variations
 * SAFE: Improved patterns that work better for ALL platforms
 */

/**
 * Extract amount with enhanced patterns (IMPROVED for all platforms)
 */
function extractAmount(content, platform = "generic") {
  if (!content) return null;

  console.log(
    `💰 Amount Extractor: Processing ${platform} content with enhanced patterns...`
  );

  // Get enhanced platform-specific patterns
  const patterns = getEnhancedAmountPatterns(platform);
  const foundAmounts = [];

  // Try each pattern and collect candidates
  for (const patternGroup of patterns) {
    const { patterns: groupPatterns, priority, description } = patternGroup;

    for (const pattern of groupPatterns) {
      const matches = [...content.matchAll(pattern)];

      for (const match of matches) {
        const amountStr = match[1] || match[2] || match[3]; // Flexible capture groups
        const amount = parseAmount(amountStr);

        if (amount && isValidAmount(amount, platform)) {
          foundAmounts.push({
            amount,
            priority,
            context: match[0],
            description,
            pattern: pattern.toString().substring(0, 50) + "...",
            rawMatch: amountStr,
          });
        }
      }
    }
  }

  if (foundAmounts.length === 0) {
    console.log(`❌ Amount Extractor: No valid amounts found for ${platform}`);
    return null;
  }

  // Sort by priority (highest first), then by amount (prefer order totals)
  foundAmounts.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return b.amount - a.amount;
  });

  const selected = foundAmounts[0];
  console.log(
    `✅ Amount Extractor: Selected ₹${selected.amount} (${selected.description})`
  );
  console.log(
    `💡 Top candidates:`,
    foundAmounts
      .slice(0, 3)
      .map((a) => `₹${a.amount} (${a.description}, priority: ${a.priority})`)
  );

  return selected.amount;
}

/**
 * 🔧 ENHANCED amount patterns for all platforms (SAFE - additive improvements)
 */
function getEnhancedAmountPatterns(platform) {
  // ✅ ENHANCED: Universal patterns that work for ALL platforms
  const universalPatterns = [
    {
      patterns: [
        // ✅ ENHANCED: Grand Total patterns with flexible currency symbols
        /Grand\s*Total[:\s]*(?:₹|â‚¨|Rs\.?|INR)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
        /Order\s*Total[:\s]*(?:₹|â‚¨|Rs\.?|INR)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
        /Total\s*Amount[:\s]*(?:₹|â‚¨|Rs\.?|INR)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
        /Final\s*Amount[:\s]*(?:₹|â‚¨|Rs\.?|INR)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
      ],
      priority: 100,
      description: "Grand Total",
    },
    {
      patterns: [
        // ✅ ENHANCED: Payment patterns with better currency handling
        /Amount\s*Paid[:\s]*(?:₹|â‚¨|Rs\.?|INR)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
        /Payment\s*Amount[:\s]*(?:₹|â‚¨|Rs\.?|INR)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
        /Billing\s*Total[:\s]*(?:₹|â‚¨|Rs\.?|INR)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
        /Amount\s*to\s*Pay[:\s]*(?:₹|â‚¨|Rs\.?|INR)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
      ],
      priority: 95,
      description: "Payment Amount",
    },
    {
      patterns: [
        // ✅ ENHANCED: Generic Total patterns with flexible symbols
        /Total[:\s]*(?:₹|â‚¨|Rs\.?|INR)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
        /(?:₹|â‚¨|Rs\.?|INR)[.\s]*([\d,]+(?:\.\d{2})?)\s*Total/gi,
      ],
      priority: 80,
      description: "Generic Total",
    },
  ];

  // Platform-specific enhanced patterns
  const platformSpecificPatterns = {
    amazon: [
      ...universalPatterns,
      {
        patterns: [
          // Amazon-specific patterns (ENHANCED)
          /Subtotal[:\s]*(?:₹|â‚¨|Rs\.?|INR)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
          /Order\s*Subtotal[:\s]*(?:₹|â‚¨|Rs\.?|INR)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
          /Item\s*Subtotal[:\s]*(?:₹|â‚¨|Rs\.?|INR)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
        ],
        priority: 85,
        description: "Amazon Subtotal",
      },
    ],

    flipkart: [
      ...universalPatterns,
      {
        patterns: [
          // ✅ ENHANCED: Flipkart-specific patterns with complete currency coverage
          /Shipment\s*[Tt]otal[:\s]*(?:₹|â‚¨|Rs\.?|INR)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
          /Order\s*Value[:\s]*(?:₹|â‚¨|Rs\.?|INR)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
          /Cart\s*Total[:\s]*(?:₹|â‚¨|Rs\.?|INR)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
          /Item\s*Total[:\s]*(?:₹|â‚¨|Rs\.?|INR)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
        ],
        priority: 90,
        description: "Flipkart Order Value",
      },
    ],

    myntra: [
      ...universalPatterns,
      {
        patterns: [
          // Myntra-specific patterns (ENHANCED)
          /Order\s*Amount[:\s]*(?:₹|â‚¨|Rs\.?|INR)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
          /Merchandise\s*Total[:\s]*(?:₹|â‚¨|Rs\.?|INR)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
          /Fashion\s*Total[:\s]*(?:₹|â‚¨|Rs\.?|INR)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
        ],
        priority: 85,
        description: "Myntra Order Amount",
      },
    ],

    nykaa: [
      ...universalPatterns,
      {
        patterns: [
          // Nykaa-specific patterns (ENHANCED)
          /Cart\s*Value[:\s]*(?:₹|â‚¨|Rs\.?|INR)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
          /Net\s*Amount[:\s]*(?:₹|â‚¨|Rs\.?|INR)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
          /Beauty\s*Total[:\s]*(?:₹|â‚¨|Rs\.?|INR)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
        ],
        priority: 85,
        description: "Nykaa Cart Value",
      },
    ],

    generic: [
      ...universalPatterns,
      {
        patterns: [
          // ✅ ENHANCED: Generic patterns with comprehensive currency support
          /(?:₹|â‚¨|Rs\.?|INR)[.\s]*([\d,]+(?:\.\d{2})?)/g,
        ],
        priority: 60,
        description: "Generic Currency Pattern",
      },
    ],
  };

  return platformSpecificPatterns[platform] || platformSpecificPatterns.generic;
}

/**
 * Parse amount string to number (ENHANCED)
 */
function parseAmount(amountStr) {
  if (!amountStr) return null;

  // ✅ ENHANCED: More thorough cleaning
  const cleaned = amountStr
    .replace(/,/g, "") // Remove commas (EXISTING)
    .replace(/\s/g, "") // Remove spaces (EXISTING)
    .replace(/[^\d.]/g, ""); // ✅ ENHANCED: Remove ALL non-numeric chars except decimal

  const amount = parseFloat(cleaned);

  if (isNaN(amount)) {
    console.log(`❌ Could not parse amount: "${amountStr}" → "${cleaned}"`);
    return null;
  }

  return amount;
}

/**
 * Validate if amount is reasonable for the platform (ENHANCED ranges)
 */
function isValidAmount(amount, platform) {
  if (!amount || amount <= 0) return false;

  // ✅ ENHANCED: Updated platform-specific ranges based on real data
  const ranges = {
    amazon: { min: 1, max: 100000 }, // Amazon India (EXISTING)
    flipkart: { min: 1, max: 100000 }, // ✅ ENHANCED: Flipkart range
    myntra: { min: 100, max: 50000 }, // Fashion items (EXISTING)
    nykaa: { min: 50, max: 25000 }, // Beauty products (EXISTING)
    ajio: { min: 100, max: 50000 }, // Fashion (EXISTING)
    meesho: { min: 50, max: 10000 }, // Budget items (EXISTING)
    bigbasket: { min: 100, max: 10000 }, // Groceries (EXISTING)
    generic: { min: 1, max: 100000 }, // Generic range (EXISTING)
  };

  const range = ranges[platform] || ranges.generic;
  const isValid = amount >= range.min && amount <= range.max;

  if (!isValid) {
    console.log(
      `❌ Amount ₹${amount} outside valid range for ${platform} (₹${range.min}-₹${range.max})`
    );
  }

  return isValid;
}

/**
 * Format amount for display (ENHANCED - Indian number system)
 */
function formatAmount(amount) {
  if (!amount || amount === 0) return "₹0";

  // ✅ ENHANCED: Format with Indian number system
  if (amount >= 10000000) {
    // 1 crore
    return `₹${(amount / 10000000).toLocaleString("en-IN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })} Cr`;
  } else if (amount >= 100000) {
    // 1 lakh
    return `₹${(amount / 100000).toLocaleString("en-IN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })} L`;
  } else if (amount >= 1000) {
    return `₹${amount.toLocaleString("en-IN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}`;
  }

  return `₹${amount}`;
}

/**
 * Extract amounts with context for debugging (ENHANCED)
 */
function extractAmountsWithContext(content, platform = "generic") {
  const patterns = getEnhancedAmountPatterns(platform);
  const results = [];

  for (const patternGroup of patterns) {
    for (const pattern of patternGroup.patterns) {
      const matches = [...content.matchAll(pattern)];

      for (const match of matches) {
        const amountStr = match[1] || match[2] || match[3];
        const amount = parseAmount(amountStr);

        if (amount && isValidAmount(amount, platform)) {
          results.push({
            amount,
            context: match[0],
            priority: patternGroup.priority,
            description: patternGroup.description,
            position: match.index,
            rawMatch: amountStr,
            cleanedMatch: amountStr.replace(/[^\d.]/g, ""),
          });
        }
      }
    }
  }

  return results.sort((a, b) => b.priority - a.priority);
}

/**
 * 🧪 Debug amount extraction for specific platforms
 */
function debugAmountExtraction(content, platform) {
  console.log(`🔍 DEBUG: Amount extraction for ${platform}`);
  console.log(`📝 Content length: ${content.length} characters`);
  console.log(`📝 Content preview: ${content.substring(0, 300)}...`);

  const amounts = extractAmountsWithContext(content, platform);

  console.log(`💰 Found ${amounts.length} potential amounts:`);
  amounts.forEach((item, index) => {
    console.log(
      `  ${index + 1}. ₹${item.amount} - ${item.description} (priority: ${
        item.priority
      })`
    );
    console.log(`     Context: "${item.context}"`);
    console.log(
      `     Raw match: "${item.rawMatch}" → Cleaned: "${item.cleanedMatch}"`
    );
  });

  const selected = amounts[0];
  if (selected) {
    console.log(`✅ Selected: ₹${selected.amount} (${selected.description})`);
  } else {
    console.log(`❌ No valid amounts found`);
  }

  return selected?.amount || null;
}

/**
 * 🧪 Test amount extraction with various currency formats
 */
function testAmountExtractionPatterns() {
  const testCases = [
    // Flipkart variations
    {
      text: "Amount Paid ₹. 804 + 44 coins",
      platform: "flipkart",
      expected: 804,
    },
    {
      text: "Amount Paid Rs. 804 + 44 coins",
      platform: "flipkart",
      expected: 804,
    },
    { text: "Shipment total ₹. 804 + 44", platform: "flipkart", expected: 804 },
    { text: "Order Value Rs. 1,250", platform: "flipkart", expected: 1250 },

    // Amazon variations
    { text: "Order Total: Rs. 1,250.00", platform: "amazon", expected: 1250 },
    { text: "Subtotal: ₹ 890", platform: "amazon", expected: 890 },
    { text: "Amount: ₹2,100", platform: "amazon", expected: 2100 },

    // Myntra variations
    { text: "Order Amount: Rs. 2,500", platform: "myntra", expected: 2500 },
    { text: "Total: ₹ 1,800.50", platform: "myntra", expected: 1800.5 },

    // Generic variations
    { text: "Total Amount: ₹450", platform: "generic", expected: 450 },
    { text: "Grand Total Rs. 999", platform: "generic", expected: 999 },
  ];

  console.log("🧪 TESTING ENHANCED AMOUNT PATTERNS:");
  console.log("=".repeat(50));

  let passed = 0;
  testCases.forEach((testCase, index) => {
    const result = extractAmount(testCase.text, testCase.platform);
    const success = result === testCase.expected;

    console.log(
      `${index + 1}. [${testCase.platform.toUpperCase()}] "${testCase.text}"`
    );
    console.log(
      `   Expected: ₹${testCase.expected}, Got: ${
        result ? `₹${result}` : "null"
      } ${success ? "✅" : "❌"}`
    );

    if (success) passed++;
  });

  console.log(
    `\n📊 RESULTS: ${passed}/${testCases.length} tests passed (${Math.round(
      (passed / testCases.length) * 100
    )}%)`
  );

  return {
    passed,
    total: testCases.length,
    successRate: Math.round((passed / testCases.length) * 100),
  };
}

/**
 * 🎯 Platform-specific amount extraction (for specialized needs)
 */
function extractAmountForPlatform(content, platform) {
  console.log(`🎯 Extracting amount specifically for ${platform}...`);

  // Use platform-specific optimizations
  switch (platform) {
    case "flipkart":
      return extractFlipkartAmount(content);
    case "amazon":
      return extractAmazonAmount(content);
    case "myntra":
      return extractMyntraAmount(content);
    default:
      return extractAmount(content, platform);
  }
}

/**
 * 🛒 Flipkart-specific amount extraction (handles all variations)
 */
function extractFlipkartAmount(content) {
  const flipkartPatterns = [
    // Highest priority - Flipkart-specific labels
    /Amount\s*Paid[:\s]*(?:₹|â‚¨|Rs\.?)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
    /Shipment\s*[Tt]otal[:\s]*(?:₹|â‚¨|Rs\.?)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
    /Order\s*Value[:\s]*(?:₹|â‚¨|Rs\.?)[.\s]*([\d,]+(?:\.\d{2})?)/gi,

    // Medium priority
    /Cart\s*Total[:\s]*(?:₹|â‚¨|Rs\.?)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
    /Total\s*Amount[:\s]*(?:₹|â‚¨|Rs\.?)[.\s]*([\d,]+(?:\.\d{2})?)/gi,

    // Fallback
    /(?:₹|â‚¨|Rs\.?)[.\s]*([\d,]+(?:\.\d{2})?)/g,
  ];

  for (const pattern of flipkartPatterns) {
    const match = content.match(pattern);
    if (match) {
      const amount = parseAmount(match[1]);
      if (amount && isValidAmount(amount, "flipkart")) {
        console.log(`✅ Flipkart amount found: ₹${amount} from "${match[0]}"`);
        return amount;
      }
    }
  }

  console.log("❌ No Flipkart amount found");
  return null;
}

/**
 * 📦 Amazon-specific amount extraction (enhanced but unchanged logic)
 */
function extractAmazonAmount(content) {
  const amazonPatterns = [
    /Order\s*Total[:\s]*(?:₹|Rs\.?)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
    /Subtotal[:\s]*(?:₹|Rs\.?)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
    /Total[:\s]*(?:₹|Rs\.?)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
    /(?:₹|Rs\.?)[.\s]*([\d,]+(?:\.\d{2})?)/g,
  ];

  for (const pattern of amazonPatterns) {
    const match = content.match(pattern);
    if (match) {
      const amount = parseAmount(match[1]);
      if (amount && isValidAmount(amount, "amazon")) {
        return amount;
      }
    }
  }

  return null;
}

/**
 * 👗 Myntra-specific amount extraction (enhanced but unchanged logic)
 */
function extractMyntraAmount(content) {
  const myntraPatterns = [
    /Order\s*Amount[:\s]*(?:₹|Rs\.?)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
    /Total\s*Amount[:\s]*(?:₹|Rs\.?)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
    /Merchandise\s*Total[:\s]*(?:₹|Rs\.?)[.\s]*([\d,]+(?:\.\d{2})?)/gi,
    /(?:₹|Rs\.?)[.\s]*([\d,]+(?:\.\d{2})?)/g,
  ];

  for (const pattern of myntraPatterns) {
    const match = content.match(pattern);
    if (match) {
      const amount = parseAmount(match[1]);
      if (amount && isValidAmount(amount, "myntra")) {
        return amount;
      }
    }
  }

  return null;
}

/**
 * 📊 Analyze amount extraction performance across platforms
 */
function analyzeAmountExtractionPerformance(emailSamples) {
  console.log("📊 ANALYZING AMOUNT EXTRACTION PERFORMANCE:");
  console.log("=".repeat(50));

  const results = {
    platforms: {},
    overall: { attempted: 0, successful: 0, failed: 0 },
  };

  emailSamples.forEach((sample, index) => {
    const { content, platform, expectedAmount } = sample;

    console.log(`\n${index + 1}. Testing ${platform} email...`);

    const extractedAmount = extractAmount(content, platform);
    const success = extractedAmount === expectedAmount;

    // Update statistics
    if (!results.platforms[platform]) {
      results.platforms[platform] = { attempted: 0, successful: 0, failed: 0 };
    }

    results.platforms[platform].attempted++;
    results.overall.attempted++;

    if (success) {
      results.platforms[platform].successful++;
      results.overall.successful++;
      console.log(
        `   ✅ SUCCESS: Expected ₹${expectedAmount}, Got ₹${extractedAmount}`
      );
    } else {
      results.platforms[platform].failed++;
      results.overall.failed++;
      console.log(
        `   ❌ FAILED: Expected ₹${expectedAmount}, Got ${
          extractedAmount ? `₹${extractedAmount}` : "null"
        }`
      );
    }
  });

  // Print summary
  console.log(`\n📈 PERFORMANCE SUMMARY:`);
  console.log(
    `Overall: ${results.overall.successful}/${
      results.overall.attempted
    } (${Math.round(
      (results.overall.successful / results.overall.attempted) * 100
    )}%)`
  );

  Object.entries(results.platforms).forEach(([platform, stats]) => {
    const rate = Math.round((stats.successful / stats.attempted) * 100);
    console.log(
      `${platform}: ${stats.successful}/${stats.attempted} (${rate}%)`
    );
  });

  return results;
}

/**
 * 🔧 Backwards compatibility aliases (SAFE)
 */
//const debugAmountExtraction = debugAmountExtraction; // Keep existing name

// ✅ ENHANCED: Alternative function names for different use cases
const extractCurrencyAmount = extractAmount;
const parseIndianCurrency = parseAmount;
const validateOrderAmount = isValidAmount;

// Run tests on module load (for development)
if (process.env.NODE_ENV === "development") {
  console.log("🧪 Running amount extraction tests...");
  testAmountExtractionPatterns();
}

module.exports = {
  // Primary exports (ENHANCED but compatible)
  extractAmount,
  formatAmount,
  extractAmountsWithContext,
  debugAmountExtraction,
  parseAmount,
  isValidAmount,

  // ✅ NEW enhanced exports
  extractAmountForPlatform,
  extractFlipkartAmount,
  extractAmazonAmount,
  extractMyntraAmount,
  testAmountExtractionPatterns,
  analyzeAmountExtractionPerformance,

  // Alternative names for compatibility
  extractCurrencyAmount,
  parseIndianCurrency,
  validateOrderAmount,

  // Enhanced patterns access
  getEnhancedAmountPatterns,
};
