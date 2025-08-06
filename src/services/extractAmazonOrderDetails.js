// src/services/extractAmazonOrderDetails.js - FIXED VERSION

const cheerio = require("cheerio");

function extractAmazonOrderDetails(html) {
  const $ = cheerio.load(html || "");

  // 1. Extract order ID with FIXED regex patterns
  let orderId = null;
  const fullText = $.text();

  // Fixed order ID patterns with proper capture groups
  const orderIdPatterns = [
    /Order\s*#\s*([0-9]{3}-[0-9]{7,8}-[0-9]{7,8})/i,
    /Order\s*ID[:\s]*([0-9]{3}-[0-9]{7,8}-[0-9]{7,8})/i,
    /Order[:\s]*([0-9]{3}-[0-9]{7,8}-[0-9]{7,8})/i,
    /([0-9]{3}-[0-9]{7,8}-[0-9]{7,8})/,
  ];

  for (const pattern of orderIdPatterns) {
    const match = fullText.match(pattern);
    if (match && match[1]) {
      orderId = match[1];
      break;
    }
  }

  if (!orderId) {
    console.log("No Amazon order ID found in:", fullText.substring(0, 500));
    return null;
  }

  // 2. Extract item name, quantity, and price
  let items = [];

  // Method 1: Look for structured item data
  const itemPatterns = [
    /([A-Za-z][^₹\n\r]{15,120})\s*Quantity[:\s]*(\d+)\s*₹\s*([\d,]+(?:\.\d+)?)/gi,
    /([A-Za-z][^₹\n\r]{20,120})\s*Qty[:\s]*(\d+)\s*₹\s*([\d,]+(?:\.\d+)?)/gi,
  ];

  for (const pattern of itemPatterns) {
    let match;
    pattern.lastIndex = 0; // Reset global regex
    while ((match = pattern.exec(fullText)) !== null && items.length < 3) {
      const name = match[1]
        .trim()
        .replace(/[₹$£€]\s*[\d,.]*/g, "") // Remove any prices
        .replace(/\s+/g, " ")
        .trim();

      if (name.length >= 10) {
        items.push({
          name: name.substring(0, 150),
          quantity: parseInt(match[2]) || 1,
          price: parseFloat(match[3].replace(/,/g, "")) || 0,
        });
      }
    }
    if (items.length > 0) break;
  }

  // Method 2: Extract from HTML links if no items found
  if (items.length === 0) {
    $('a[href*="/dp/"]').each((_, el) => {
      const productName = $(el).text().trim();
      if (productName.length > 15) {
        const container = $(el).closest("table, div, td");
        const containerText = container.text();

        const quantityMatch = containerText.match(/Quantity[:\s]*(\d+)/i);
        const priceMatch = containerText.match(/₹\s*([\d,]+(?:\.\d+)?)/);

        items.push({
          name: productName.substring(0, 150),
          quantity: quantityMatch ? parseInt(quantityMatch[1]) : 1,
          price: priceMatch ? parseFloat(priceMatch[1].replace(/,/g, "")) : 0,
        });

        return false; // Break after first item
      }
    });
  }

  // Method 3: Simple product name extraction if still no items
  if (items.length === 0) {
    const productPatterns = [
      /([A-Za-z][^₹\n\r]{20,120})\s*(?:Quantity|Arriving)/i,
      /([A-Za-z][^₹\n\r]{25,150})\s*(?:₹)/i,
    ];

    for (const pattern of productPatterns) {
      const match = fullText.match(pattern);
      if (match && match[1]) {
        const name = match[1]
          .trim()
          .replace(/[₹$£€]\s*[\d,.]*/g, "")
          .replace(/\s+/g, " ")
          .trim();

        if (name.length >= 15) {
          items.push({
            name: name.substring(0, 150),
            quantity: 1,
            price: 0,
          });
          break;
        }
      }
    }
  }

  // 3. Extract order total with FIXED patterns
  let total = null;
  const totalPatterns = [
    /Total[:\s]*₹\s*([\d,]+(?:\.\d+)?)/i,
    /Order\s*Total[:\s]*₹\s*([\d,]+(?:\.\d+)?)/i,
    /Grand\s*Total[:\s]*₹\s*([\d,]+(?:\.\d+)?)/i,
  ];

  // Try each pattern
  for (const pattern of totalPatterns) {
    const match = fullText.match(pattern);
    if (match && match[1]) {
      const amount = parseFloat(match[1].replace(/,/g, ""));
      if (amount > 0) {
        total = amount;
        break;
      }
    }
  }

  // If no specific total found, try to extract any reasonable amount
  if (!total) {
    const amountMatches = fullText.match(/₹\s*([\d,]+(?:\.\d+)?)/g);
    if (amountMatches) {
      // Get the largest amount (likely the total)
      const amounts = amountMatches
        .map((m) => parseFloat(m.replace(/[₹,]/g, "")))
        .filter((a) => a > 0 && a < 100000)
        .sort((a, b) => b - a);

      if (amounts.length > 0) {
        total = amounts[0];
      }
    }
  }

  // 4. Extract delivery ETA
  let delivery_eta = null;
  const deliveryPatterns = [
    /Arriving\s+(.+?)(?=\s|$|\n)/i,
    /Expected\s+by\s+(.+?)(?=\s|$|\n)/i,
    /Delivery\s+by\s+(.+?)(?=\s|$|\n)/i,
  ];

  for (const pattern of deliveryPatterns) {
    const match = fullText.match(pattern);
    if (match && match[1]) {
      delivery_eta = match[1].trim();
      break;
    }
  }

  // 5. Determine status
  let status = "Shipped"; // Default for shipping emails

  const lowerText = fullText.toLowerCase();
  if (
    lowerText.includes("delivered") ||
    lowerText.includes("package delivered")
  ) {
    status = "Delivered";
  } else if (
    lowerText.includes("out for delivery") ||
    lowerText.includes("arriving today")
  ) {
    status = "Out for Delivery";
  } else if (
    lowerText.includes("shipped") ||
    lowerText.includes("dispatched")
  ) {
    status = "Shipped";
  }

  const result = {
    platform: "amazon",
    order_id: orderId,
    items: items,
    total: total,
    delivery_eta: delivery_eta,
    status: status,
  };

  console.log("Amazon extraction result:", {
    orderId: orderId,
    itemsCount: items.length,
    total: total,
    status: status,
    items: items.map((i) => ({
      name: i.name?.substring(0, 50),
      quantity: i.quantity,
      price: i.price,
    })),
  });

  return result;
}

module.exports = extractAmazonOrderDetails;
