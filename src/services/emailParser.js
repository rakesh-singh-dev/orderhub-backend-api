// src/services/emailParser.js - COMPLETE FIXED VERSION - READY TO PASTE

const cheerio = require("cheerio");
const { platforms } = require("../config/emailConfig");
const { normalizeOrderId, normalizeText } = require("../utils/normalize");
const extractAmazonOrderDetails = require("./extractAmazonOrderDetails");
const logger = require("../utils/logger").createModuleLogger("EmailParser");

// Fixed extraction function
function extractFieldByPatterns(content, patterns) {
  if (!patterns || !Array.isArray(patterns)) return null;

  for (const pattern of patterns) {
    try {
      let match;
      if (pattern.global) {
        pattern.lastIndex = 0;
        match = pattern.exec(content);
      } else {
        match = content.match(pattern);
      }

      if (match) {
        const result = match[1] || match[0];
        if (result && result.trim()) {
          logger.debug("Pattern matched", {
            pattern: pattern.toString(),
            result: result.trim(),
          });
          return result.trim();
        }
      }
    } catch (error) {
      logger.debug("Pattern error", {
        pattern: pattern.toString(),
        error: error.message,
      });
    }
  }
  return null;
}

// FIXED: Enhanced Amazon item extraction
function extractAmazonItems(html, text) {
  console.log("🔍 Amazon items extraction starting...");
  const items = [];
  const content = html || text || "";

  try {
    // Method 1: Enhanced HTML parsing with better filtering
    if (html) {
      const $ = cheerio.load(html);
      console.log("📄 Using HTML parsing for Amazon items...");

      // Target actual product titles and links with better validation
      const productSelectors = [
        'a[href*="/dp/"] span', // Product title spans inside DP links
        'a[href*="/dp/"]', // Direct DP links
        ".productTitle", // Amazon product title class
        "[data-asin] a", // ASIN containers with links
        'td a[href*="/dp/"]', // Table cell product links
      ];

      let foundItems = [];

      for (const selector of productSelectors) {
        $(selector).each((_, el) => {
          let productName = $(el).text().trim();

          // ENHANCED: Much stricter product name validation
          const isValidProductName =
            productName.length > 10 &&
            productName.length < 200 &&
            // EXCLUDE garbage patterns
            !productName.includes("Order #") &&
            !productName.includes("Track package") &&
            !productName.includes("background-image") &&
            !productName.includes("url(https") &&
            !productName.includes("media-amazon") &&
            !productName.includes("css") &&
            !productName.includes("style") &&
            !productName.includes("font-family") &&
            !productName.includes("margin") &&
            !productName.includes("padding") &&
            !productName.match(/^\d{3}-\d{7,8}-\d{7,8}/) && // Not an order ID
            !productName.includes("UTTAR PRADESH") && // Not an address
            !productName.includes("MUZAFFARNAGAR") &&
            // MUST contain actual words (not just symbols/urls)
            /[A-Za-z]{3,}/.test(productName) && // At least 3 consecutive letters
            !/^[^A-Za-z]*$/.test(productName) && // Not just symbols/numbers
            // Should look like a product name
            (productName.includes(" ") || productName.length > 20); // Either has spaces or is long enough

          if (isValidProductName) {
            // Look for quantity and price in surrounding context
            const container = $(el).closest("table, div, td, tr");
            const containerText = container.text();

            // Enhanced quantity extraction
            let quantity = 1;
            const qtyMatches = [
              /Quantity[:\s]*(\d+)/i,
              /Qty[:\s]*(\d+)/i,
              /(\d+)\s*item[s]?/i,
            ];

            for (const qPattern of qtyMatches) {
              const qMatch = containerText.match(qPattern);
              if (qMatch) {
                quantity = parseInt(qMatch[1]);
                break;
              }
            }

            // Enhanced price extraction
            let price = 0;
            const priceMatches = [
              /₹\s*([\d,]+(?:\.\d+)?)/,
              /Price[:\s]*₹\s*([\d,]+(?:\.\d+)?)/i,
            ];

            for (const pPattern of priceMatches) {
              const pMatch = containerText.match(pPattern);
              if (pMatch) {
                price = parseFloat(pMatch[1].replace(/,/g, ""));
                break;
              }
            }

            const cleanName = cleanProductName(productName);
            if (cleanName && cleanName.length >= 10) {
              foundItems.push({
                name: cleanName,
                quantity: quantity,
                price: price,
              });
              console.log(
                `📦 Amazon HTML item: ${cleanName.substring(
                  0,
                  60
                )}... | Qty: ${quantity} | Price: ₹${price}`
              );
            }
          }
        });

        if (foundItems.length > 0) {
          items.push(...foundItems);
          break;
        }
      }
    }

    // Method 2: Enhanced text parsing with stricter validation
    if (items.length === 0) {
      console.log("📄 Using text parsing for Amazon items...");

      const lines = content.split("\n").map((line) => line.trim());

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const nextLine = lines[i + 1] || "";
        const prevLine = lines[i - 1] || "";

        // ENHANCED: Much stricter criteria for product names
        if (line.length > 15 && line.length < 150) {
          const isProductName =
            // Has product-like characteristics
            /[A-Za-z]{3,}/.test(line) && // At least 3 consecutive letters
            line.includes(" ") && // Has spaces (product names usually do)
            !line.includes("Order #") &&
            !line.includes("Track package") &&
            !line.includes("Arriving") &&
            !line.includes("Delivered") &&
            !line.includes("PRADESH") &&
            !line.includes("MUZAFFARNAGAR") &&
            !line.includes("background-image") &&
            !line.includes("url(") &&
            !line.includes("css") &&
            !line.includes("style") &&
            !line.includes("font-") &&
            !line.match(/^\d{3}-\d{7,8}-\d{7,8}/) && // Not order ID
            !line.match(/^₹/) && // Doesn't start with price
            // Context suggests it's a product
            (nextLine.includes("₹") ||
              nextLine.includes("Quantity") ||
              nextLine.includes("Arriving") ||
              prevLine.includes("Your order") ||
              line.match(/\b(Amazon|Brand|Premium|Classic|Original)\b/i)); // Product-like words

          if (isProductName) {
            const cleanName = cleanProductName(line);
            if (cleanName && cleanName.length >= 15) {
              items.push({
                name: cleanName,
                quantity: 1,
                price: 0,
              });
              console.log(
                `📦 Amazon text item: ${cleanName.substring(0, 60)}...`
              );
              break; // Take the first good match
            }
          }
        }
      }
    }
  } catch (error) {
    console.error("❌ Error extracting Amazon items:", error);
  }

  const deduplicatedItems = deduplicateItems(items);
  console.log(
    `✅ Amazon items extraction completed: ${deduplicatedItems.length} items found`
  );

  return deduplicatedItems;
}

// Enhanced Flipkart item extraction (UNCHANGED - keeping your existing code)
function extractFlipkartItems(html, text) {
  const items = [];
  const content = html || text || "";

  try {
    // Method 1: HTML parsing
    if (html) {
      const $ = cheerio.load(html);

      $("a").each((_, el) => {
        const linkText = $(el).text().trim();
        if (linkText.length > 15 && linkText.length < 150) {
          const container = $(el).closest("table, div, td");
          const containerText = container.text();

          if (
            containerText.includes("Seller") ||
            containerText.includes("Qty")
          ) {
            const quantityMatch = containerText.match(/Qty[:\s]*(\d+)/i);
            const priceMatch = containerText.match(/₨\.\s*([\d,]+)/);

            items.push({
              name: cleanProductName(linkText),
              quantity: quantityMatch ? parseInt(quantityMatch[1]) : 1,
              price: priceMatch
                ? parseFloat(priceMatch[1].replace(/,/g, ""))
                : 0.0,
            });
          }
        }
      });
    }

    // Method 2: Text pattern extraction
    if (items.length === 0) {
      const itemPatterns = [
        /([A-Za-z][^₨\n\r]{15,120})\s*Seller[:\s]*[^\n\r]*\s*Qty[:\s]*(\d+)/gi,
        /([A-Za-z][^₨\n\r]{15,120})\s*Qty[:\s]*(\d+)/gi,
      ];

      for (const pattern of itemPatterns) {
        let match;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(content)) !== null && items.length < 3) {
          const name = cleanProductName(match[1]);
          if (name && name.length >= 10) {
            items.push({
              name: name,
              quantity: parseInt(match[2]) || 1,
              price: 0.0,
            });
          }
        }
      }
    }

    // Method 3: Simple extraction based on structure
    if (items.length === 0) {
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (
          line.length > 20 &&
          line.length < 150 &&
          (lines[i + 1]?.includes("Seller") || lines[i - 1]?.includes("Seller"))
        ) {
          const name = cleanProductName(line);
          if (name && name.length >= 15) {
            items.push({
              name: name,
              quantity: 1,
              price: 0.0,
            });
            break;
          }
        }
      }
    }
  } catch (error) {
    logger.error("Error extracting Flipkart items:", error);
  }

  return deduplicateItems(items);
}

// NEW: Swiggy item extraction
function extractSwiggyItems(html, text) {
  console.log("🔍 Swiggy items extraction starting...");
  const items = [];
  const content = html || text || "";

  try {
    // Method 1: HTML parsing for Swiggy structure
    if (html) {
      const $ = cheerio.load(html);
      console.log("📄 Using HTML parsing for Swiggy items...");

      // Swiggy uses table structure with quantity and price
      $("table").each((_, table) => {
        const tableText = $(table).text();

        // Look for pattern: "1 x Item Name" followed by price
        const itemMatch = tableText.match(
          /(\d+)\s*x\s*([^₹]+?)₹([\d,]+(?:\.\d+)?)/
        );
        if (itemMatch) {
          const quantity = parseInt(itemMatch[1]);
          const name = cleanProductName(itemMatch[2]);
          const price = parseFloat(itemMatch[3].replace(/,/g, ""));

          if (name && name.length >= 5) {
            items.push({
              name: name,
              quantity: quantity,
              price: price,
            });
            console.log(
              `📦 Swiggy HTML item: ${name} | Qty: ${quantity} | Price: ₹${price}`
            );
          }
        }
      });
    }

    // Method 2: Text pattern extraction for Swiggy
    if (items.length === 0) {
      console.log("📄 Using text parsing for Swiggy items...");

      const swiggyPatterns = [
        // Pattern 1: "1 x Item Name ₹50.00"
        /(\d+)\s*x\s*([^₹\n\r]{5,100})₹([\d,]+(?:\.\d+)?)/gi,

        // Pattern 2: More flexible pattern for Swiggy items
        /(\d+)\s*x\s*([^₹\n\r]{5,100})\s*₹\s*([\d,]+(?:\.\d+)?)/gi,
      ];

      for (
        let patternIndex = 0;
        patternIndex < swiggyPatterns.length;
        patternIndex++
      ) {
        const pattern = swiggyPatterns[patternIndex];
        let match;
        pattern.lastIndex = 0;

        while ((match = pattern.exec(content)) !== null && items.length < 20) {
          const quantity = parseInt(match[1]);
          const name = cleanProductName(match[2]);
          const price = parseFloat(match[3].replace(/,/g, ""));

          if (name && name.length >= 5 && quantity > 0) {
            items.push({ name, quantity, price });
            console.log(
              `📦 Swiggy pattern ${
                patternIndex + 1
              } item: ${name} | Qty: ${quantity} | Price: ₹${price}`
            );
          }
        }

        if (items.length > 0) break; // Stop if we found items
      }
    }
  } catch (error) {
    console.error("❌ Error extracting Swiggy items:", error);
  }

  const deduplicatedItems = deduplicateItems(items);
  console.log(
    `✅ Swiggy items extraction completed: ${deduplicatedItems.length} items found`
  );

  return deduplicatedItems;
}

// FIXED: Enhanced product name cleaning
function cleanProductName(name) {
  if (!name) return null;

  return name
    .replace(/[₹₨$£€]\s*[\d,.]*/g, "") // Remove prices
    .replace(/Quantity[:\s]*\d+/gi, "") // Remove quantity text
    .replace(/Qty[:\s]*\d+/gi, "") // Remove qty text
    .replace(/Order\s*#\s*[\d-]+/gi, "") // Remove order numbers
    .replace(/Track\s*package/gi, "") // Remove track package text
    .replace(/Arriving[:\s]*[^\n]*/gi, "") // Remove arriving text
    .replace(/Delivered[:\s]*[^\n]*/gi, "") // Remove delivered text
    .replace(/MUZAFFARNAGAR.*PRADESH/gi, "") // Remove address text
    .replace(/‫/g, "") // Remove RTL marks
    .replace(/\s+/g, " ") // Normalize spaces
    .replace(/[^\w\s\-'.,()&]/g, " ") // Keep alphanumeric, spaces, common punctuation
    .replace(/^\W+|\W+$/g, "") // Trim non-word chars from start/end
    .trim()
    .substring(0, 200);
}

// Deduplicate items
function deduplicateItems(items) {
  const seen = new Set();
  const cleaned = [];

  for (const item of items) {
    if (!item.name || item.name.length < 5) continue;

    const normalized = item.name
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 50);

    if (!seen.has(normalized)) {
      seen.add(normalized);
      cleaned.push({
        name: item.name,
        quantity: item.quantity || 1,
        price: item.price || 0.0,
      });
    }
  }

  return cleaned.slice(0, 10);
}

// Enhanced platform detection
function detectPlatform({ from, subject }) {
  const lowerFrom = (from || "").toLowerCase();
  const lowerSubject = (subject || "").toLowerCase();

  return platforms.find((platform) => {
    const senderMatch = platform.senderPatterns.some((p) =>
      lowerFrom.includes(p)
    );
    const subjectMatch = platform.subjectPatterns.some((p) =>
      lowerSubject.includes(p)
    );
    return senderMatch && subjectMatch;
  });
}

// Extract items based on platform
function extractItems(content, itemPatterns, platform) {
  if (platform === "amazon") {
    return extractAmazonItems(content);
  } else if (platform === "flipkart") {
    return extractFlipkartItems(content);
  } else if (platform === "swiggy") {
    return extractSwiggyItems(content);
  }

  // Generic extraction for other platforms
  const items = [];
  if (itemPatterns) {
    for (const pattern of itemPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const name = normalizeText(match[1]);
        const price = match[2] ? parseFloat(match[2].replace(/,/g, "")) : 0.0;
        const quantity = match[3] ? parseInt(match[3]) : 1;

        if (name && name.length > 3) {
          items.push({ name, price, quantity });
        }
      }
      if (items.length > 0) break;
    }
  }
  return items.slice(0, 10);
}

// FIXED: Status normalization function
const normalizeStatus = (status) => {
  const statusMap = {
    Delivered: "delivered",
    Shipped: "shipped",
    Dispatched: "shipped",
    Confirmed: "ordered",
    "Order Placed": "ordered",
    Cancelled: "cancelled",
    Canceled: "cancelled",
  };

  // If it's already lowercase, return as is
  if (status && status === status.toLowerCase()) {
    return status;
  }

  // Convert known statuses to lowercase
  return statusMap[status] || status?.toLowerCase() || "ordered";
};

// Main parseEmail function with enhanced patterns
module.exports = {
  parseEmail({ from, subject, html, text }) {
    try {
      const content = html || text || "";
      const $ = cheerio.load(content);

      logger.debug("Parsing email", {
        from: from?.substring(0, 30),
        subject: subject?.substring(0, 50),
      });

      // 1. Platform detection
      const platformConfig = detectPlatform({ from, subject });
      if (!platformConfig) {
        logger.debug("No platform detected");
        return null;
      }

      logger.info(`Enhanced parsing for ${platformConfig.name}`);

      // 2. ENHANCED Order ID extraction
      let orderId = null;

      if (platformConfig.name === "amazon") {
        console.log("🔍 Amazon order ID extraction starting...");

        // Enhanced Amazon order ID patterns
        const amazonOrderPatterns = [
          // Primary patterns - most specific first
          /Amazon\.in\s+order\s*(?:number|#|ID)[:\s]*([0-9]{3}-[0-9]{7,8}-[0-9]{7,8})/i,
          /Order\s*(?:number|#|ID)[:\s]*([0-9]{3}-[0-9]{7,8}-[0-9]{7,8})/i,
          /Your\s+order\s*(?:number|#|ID)?[:\s]*([0-9]{3}-[0-9]{7,8}-[0-9]{7,8})/i,
          /Order[:\s]*([0-9]{3}-[0-9]{7,8}-[0-9]{7,8})/i,

          // More flexible patterns
          /([0-9]{3}-[0-9]{7,8}-[0-9]{7,8})/g,

          // Alternative formats
          /Order\s*#\s*([A-Z0-9]{10,20})/i,
          /Order\s+([A-Z0-9-]{15,25})/i,
        ];

        // Try each pattern
        for (let i = 0; i < amazonOrderPatterns.length; i++) {
          const matches = content.match(amazonOrderPatterns[i]);
          if (matches && matches[1]) {
            orderId = matches[1].trim();
            console.log(
              `✅ Amazon Order ID found with pattern ${i + 1}: ${orderId}`
            );
            break;
          }
        }

        if (!orderId) {
          console.log("❌ No Amazon order ID found");
        }
      } else if (platformConfig.name === "flipkart") {
        // Fixed Flipkart patterns (UNCHANGED)
        const flipkartPatterns = [
          /Order\s*ID[:\s]*([A-Z]{2}[0-9]{15,25})/i,
          /Order[:\s]*([A-Z]{2}[0-9]{15,25})/i,
          /([A-Z]{2}[0-9]{15,25})/,
        ];
        orderId = extractFieldByPatterns(content, flipkartPatterns);
      } else if (platformConfig.name === "swiggy") {
        console.log("🔍 Swiggy order ID extraction starting...");

        // DEBUG: Show actual email content
        console.log("📧 Swiggy email subject:", subject?.substring(0, 100));
        console.log("📧 Swiggy email from:", from?.substring(0, 50));
        console.log("📧 Swiggy content preview:", content.substring(0, 500));

        // Enhanced Swiggy order ID patterns
        const swiggyPatterns = [
          /order\s*id[:\s]*(\d{12,20})/i, // "order id: 213028581143173"
          /order[:\s]*(\d{12,20})/i, // "order 213028581143173"
          /id[:\s]*(\d{12,20})/i, // "id: 213028581143173"
          /(\d{12,20})/g, // Any 12-20 digit number
        ];

        // Try each pattern with detailed logging
        for (let i = 0; i < swiggyPatterns.length; i++) {
          const pattern = swiggyPatterns[i];
          const matches = content.match(pattern);
          console.log(
            `🔍 Swiggy pattern ${i + 1} (${pattern}):`,
            matches ? `Found "${matches[1] || matches[0]}"` : "No match"
          );

          if (matches && (matches[1] || matches[0])) {
            orderId = (matches[1] || matches[0]).trim();
            console.log(
              `✅ Swiggy Order ID found with pattern ${i + 1}: ${orderId}`
            );
            break;
          }
        }

        if (!orderId) {
          console.log("❌ No Swiggy order ID found");
          // Show all numbers found for debugging
          const allNumbers = content.match(/\d{6,}/g);
          console.log(
            "📊 All numbers found in content:",
            allNumbers?.slice(0, 10)
          );
        }
      } else {
        // Use platform config patterns
        orderId = extractFieldByPatterns(
          content,
          platformConfig.orderIdPatterns
        );
      }

      if (!orderId) {
        logger.debug(`No order ID found for ${platformConfig.name}`);
        return null;
      }

      logger.info(`Order ID found: ${orderId}`);

      // 3. ENHANCED Amount extraction
      let totalAmount = null;

      if (platformConfig.name === "amazon") {
        console.log("🔍 Amazon amount extraction starting...");

        // Enhanced Amazon amount patterns
        const amountPatterns = [
          // Primary patterns - most specific
          /(?:Grand\s+)?Total[:\s]*₹\s*([\d,]+(?:\.\d+)?)/i,
          /Order\s+Total[:\s]*₹\s*([\d,]+(?:\.\d+)?)/i,
          /Item\s+Total[:\s]*₹\s*([\d,]+(?:\.\d+)?)/i,
          /Subtotal[:\s]*₹\s*([\d,]+(?:\.\d+)?)/i,

          // More flexible patterns
          /Total\s+Amount[:\s]*₹\s*([\d,]+(?:\.\d+)?)/i,
          /Amount[:\s]*₹\s*([\d,]+(?:\.\d+)?)/i,
          /₹\s*([\d,]+(?:\.\d+)?)\s*(?:total|amount)/i,

          // Fallback - any amount over ₹50
          /₹\s*((?:[1-9]\d{2,}|[5-9]\d)(?:\.\d+)?)/i,
        ];

        let bestAmount = null;
        let bestAmountValue = 0;

        // Try each pattern and find the best match
        for (let i = 0; i < amountPatterns.length; i++) {
          const matches = content.match(amountPatterns[i]);
          if (matches && matches[1]) {
            const amountStr = matches[1];
            const amountValue = parseFloat(amountStr.replace(/,/g, ""));

            console.log(
              `💰 Amazon Pattern ${
                i + 1
              } found: "${amountStr}" = ₹${amountValue}`
            );

            // Choose the highest reasonable amount (likely the order total)
            if (amountValue > bestAmountValue && amountValue >= 20) {
              // Min ₹20 for Amazon
              bestAmount = amountStr;
              bestAmountValue = amountValue;
              console.log(`✅ New best Amazon amount: ₹${amountValue}`);
            }
          }
        }

        if (bestAmount) {
          totalAmount = bestAmountValue;
          console.log(
            `🎯 Final Amazon amount: ${bestAmount} -> ₹${totalAmount}`
          );
        } else {
          console.log("❌ No valid Amazon amount found");
        }
      } else if (platformConfig.name === "flipkart") {
        console.log("🔍 Starting Flipkart amount extraction...");

        // Enhanced patterns that will catch the main order amount (UNCHANGED - keeping your working code)
        const amountPatterns = [
          // Primary patterns - most specific first
          /(?:Item|Shipment|Order)\s*(?:Total|Amount)[:\s]*₨\s*\.?\s*([\d,]+(?:\.\d+)?)/i,
          /Grand\s*Total[:\s]*₨\s*\.?\s*([\d,]+(?:\.\d+)?)/i,
          /Total\s*Amount[:\s]*₨\s*\.?\s*([\d,]+(?:\.\d+)?)/i,
          /Total[:\s]*₨\s*\.?\s*([\d,]+(?:\.\d+)?)/i,

          // More flexible patterns for different formats
          /₨\s*\.?\s*([\d,]+(?:\.\d+)?)\s*(?:\+\s*\d+\s*coins?)?/i, // Handles "₨. 804 + 44 coins"
          /Amount[:\s]*₨\s*\.?\s*([\d,]+(?:\.\d+)?)/i,

          // Fallback patterns but exclude very small amounts
          /₨\s*\.?\s*([1-9]\d{2,}(?:\.\d+)?)/i, // Only amounts >= 100
        ];

        let bestAmount = null;
        let bestAmountValue = 0;

        // Try each pattern and find the best match
        for (let i = 0; i < amountPatterns.length; i++) {
          const matches = content.match(amountPatterns[i]);
          if (matches && matches[1]) {
            const amountStr = matches[1];
            const amountValue = parseFloat(amountStr.replace(/,/g, ""));

            console.log(
              `💰 Flipkart Pattern ${
                i + 1
              } found: "${amountStr}" = ₹${amountValue}`
            );

            // Choose the highest reasonable amount (likely the order total)
            // Exclude amounts that are too small (likely coins or fees)
            if (amountValue > bestAmountValue && amountValue >= 50) {
              bestAmount = amountStr;
              bestAmountValue = amountValue;
              console.log(`✅ New best amount: ₹${amountValue}`);
            }
          }
        }

        if (bestAmount) {
          totalAmount = bestAmountValue;
          console.log(
            `🎯 Final Flipkart amount: ${bestAmount} -> ₹${totalAmount}`
          );
        } else {
          console.log("❌ No valid Flipkart amount found");

          // Debug: Show a sample of the content to help troubleshoot
          const contentSample = content.substring(0, 1000);
          console.log("📄 Content sample for debugging:", contentSample);
        }
      } else if (platformConfig.name === "swiggy") {
        console.log("🔍 Swiggy amount extraction starting...");

        // ENHANCED: Prioritize Grand Total patterns first
        const swiggyAmountPatterns = [
          // MOST SPECIFIC PATTERNS FIRST - Grand Total
          /Grand\s*Total[:\s]*₹\s*([\d,]+(?:\.\d+)?)/i,
          /Total[:\s]*₹\s*([\d,]+(?:\.\d+)?)\s*(?!.*item|.*qty|.*quantity)/i, // Total not followed by item/qty

          // HTML table patterns for Grand Total
          /<td[^>]*>\s*Grand\s*Total\s*<\/td>\s*<td[^>]*>\s*₹\s*([\d,]+(?:\.\d+)?)\s*<\/td>/i,
          /<td[^>]*>\s*Total\s*<\/td>\s*<td[^>]*>\s*₹\s*([\d,]+(?:\.\d+)?)\s*<\/td>/i,

          // Order Summary section patterns
          /Order\s*Summary[\s\S]*?Grand\s*Total[\s\S]*?₹\s*([\d,]+(?:\.\d+)?)/i,
          /Order\s*Summary[\s\S]*?Total[\s\S]*?₹\s*([\d,]+(?:\.\d+)?)/i,

          // Fallback patterns - but exclude amounts that are clearly item prices
          /₹\s*((?:[5-9]\d{2,}|[1-9]\d{3,})(?:\.\d+)?)\s*(?!.*x\s|.*quantity|.*qty)/i, // ₹500+ not followed by "x" or qty
        ];

        let bestAmount = null;
        let bestAmountValue = 0;

        for (let i = 0; i < swiggyAmountPatterns.length; i++) {
          const matches = content.match(swiggyAmountPatterns[i]);
          if (matches && matches[1]) {
            const amountStr = matches[1];
            const amountValue = parseFloat(amountStr.replace(/,/g, ""));

            console.log(
              `💰 Swiggy Pattern ${
                i + 1
              } found: "${amountStr}" = ₹${amountValue}`
            );

            // For Swiggy, Grand Total should be highest amount (sum of all items + fees)
            if (amountValue > bestAmountValue && amountValue >= 100) {
              // Min ₹100 for order total
              bestAmount = amountStr;
              bestAmountValue = amountValue;
              console.log(`✅ New best Swiggy amount: ₹${amountValue}`);
            }
          }
        }

        if (bestAmount) {
          totalAmount = bestAmountValue;
          console.log(
            `🎯 Final Swiggy amount: ${bestAmount} -> ₹${totalAmount}`
          );
        } else {
          console.log("❌ No valid Swiggy amount found");
          // Debug: Show Grand Total context
          const grandTotalContext = content.match(
            /Grand\s*Total[\s\S]{0,100}/i
          );
          console.log("📄 Grand Total context:", grandTotalContext?.[0]);
        }
      } else {
        const amountStr = extractFieldByPatterns(
          content,
          platformConfig.amountPatterns
        );
        if (amountStr) {
          totalAmount = parseFloat(amountStr.replace(/,/g, ""));
        }
      }

      // 4. Extract other data
      const deliveryAddress = extractFieldByPatterns(
        content,
        platformConfig.addressPatterns
      );
      const trackingId = extractFieldByPatterns(
        content,
        platformConfig.trackingPatterns
      );

      // 5. FIXED: Extract items based on platform (disable conflicting Amazon function)
      let items = [];
      let amazonOrderDetails = null;

      if (platformConfig.name === "amazon") {
        console.log("🔍 Amazon amount extraction starting...");

        // ENHANCED: More specific Amazon amount patterns
        const amountPatterns = [
          // MOST SPECIFIC PATTERNS FIRST
          /Order\s+Total[:\s]*₹\s*([\d,]+(?:\.\d+)?)/i,
          /Grand\s+Total[:\s]*₹\s*([\d,]+(?:\.\d+)?)/i,
          /Total[:\s]*₹\s*([\d,]+(?:\.\d+)?)\s*(?!.*item|.*qty|.*x\s)/i, // Total not followed by item indicators

          // HTML table patterns for totals
          /<td[^>]*>.*?Total.*?<\/td>[\s\S]*?₹\s*([\d,]+(?:\.\d+)?)/i,

          // Subtotal patterns as fallback
          /Item\s+Total[:\s]*₹\s*([\d,]+(?:\.\d+)?)/i,
          /Subtotal[:\s]*₹\s*([\d,]+(?:\.\d+)?)/i,

          // More flexible patterns but exclude small amounts
          /₹\s*((?:[2-9]\d{2,}|[1-9]\d{3,})(?:\.\d+)?)\s*(?!.*item|.*qty|.*x\s)/i, // ₹200+ not item-related
        ];

        let bestAmount = null;
        let bestAmountValue = 0;

        // Try each pattern and find the best match
        for (let i = 0; i < amountPatterns.length; i++) {
          const matches = content.match(amountPatterns[i]);
          if (matches && matches[1]) {
            const amountStr = matches[1];
            const amountValue = parseFloat(amountStr.replace(/,/g, ""));

            console.log(
              `💰 Amazon Pattern ${
                i + 1
              } found: "${amountStr}" = ₹${amountValue}`
            );

            // For Amazon, prioritize higher amounts (likely order totals)
            if (amountValue > bestAmountValue && amountValue >= 50) {
              // Min ₹50 for Amazon orders
              bestAmount = amountStr;
              bestAmountValue = amountValue;
              console.log(`✅ New best Amazon amount: ₹${amountValue}`);
            }
          }
        }

        if (bestAmount) {
          totalAmount = bestAmountValue;
          console.log(
            `🎯 Final Amazon amount: ${bestAmount} -> ₹${totalAmount}`
          );
        } else {
          console.log("❌ No valid Amazon amount found");
          // Debug: Show order total context
          const orderTotalContext = content.match(
            /Order\s+Total[\s\S]{0,100}/i
          );
          console.log("📄 Order Total context:", orderTotalContext?.[0]);
        }
      } else if (platformConfig.name === "flipkart") {
        items = extractFlipkartItems(html, text);
      } else if (platformConfig.name === "swiggy") {
        items = extractSwiggyItems(html, text);
      } else {
        items = extractItems(
          content,
          platformConfig.itemPatterns,
          platformConfig.name
        );
      }

      // 6. FIXED: Status detection with normalization
      let status = "ordered";
      if (platformConfig.statusKeywords) {
        for (const [statusKey, keywords] of Object.entries(
          platformConfig.statusKeywords
        )) {
          if (keywords.some((k) => content.toLowerCase().includes(k))) {
            status = statusKey;
            break;
          }
        }
      }

      const result = {
        platform: platformConfig.name,
        orderId: amazonOrderDetails?.order_id || normalizeOrderId(orderId),
        totalAmount: amazonOrderDetails?.total || totalAmount,
        items,
        status: normalizeStatus(amazonOrderDetails?.status || status), // APPLY NORMALIZATION
        deliveryEta: amazonOrderDetails?.delivery_eta,
        deliveryAddress: deliveryAddress
          ? normalizeText(deliveryAddress)
          : null,
        trackingId,
        raw: { from, subject },
      };

      // ADDED: Final result validation and logging
      console.log("📊 FINAL PARSING RESULT:", {
        platform: platformConfig.name,
        orderId: result.orderId,
        totalAmount: result.totalAmount,
        itemsCount: items.length,
        items: items.map((item) => ({
          name: item.name?.substring(0, 50) + "...",
          quantity: item.quantity,
          price: item.price,
        })),
      });

      // Validate items structure
      if (items.length > 0) {
        console.log("✅ Items structure validation:");
        items.forEach((item, index) => {
          console.log(`  Item ${index + 1}:`, {
            hasName: !!item.name,
            nameLength: item.name?.length || 0,
            hasQuantity: typeof item.quantity === "number",
            hasPrice: typeof item.price === "number",
            structure: Object.keys(item),
          });
        });
      } else {
        console.log("⚠️  No items found for this order");
      }

      logger.info(`Order parsed successfully`, {
        platform: result.platform,
        orderId: result.orderId,
        itemsCount: items.length,
        amount: result.totalAmount,
      });

      return result;
    } catch (error) {
      logger.error("Email parsing error:", error);
      return null;
    }
  },
};
