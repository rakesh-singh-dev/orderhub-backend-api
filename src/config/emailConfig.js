// src/config/emailConfig.js - FIXED VERSION

module.exports = {
  platforms: [
    {
      name: "amazon",
      displayName: "Amazon",
      // FIXED: More comprehensive sender patterns
      senderPatterns: ["amazon.in", "amazon.com", "@amazon"],
      // FIXED: More comprehensive subject patterns that match your actual emails
      subjectPatterns: [
        "shipped", // Matches "Shipped: ROOVI Pure 925..."
        "delivered", // Matches delivered emails
        "dispatched", // Matches dispatched emails
        "your order", // Original pattern
        "order confirmation",
        "order#",
        "order id",
        "order", // Generic order pattern
      ],
      orderIdPatterns: [
        /\b\d{3}-\d{7,8}-\d{7,8}\b/, // This will NOT match junk words like AINTAINING, DECORATION, etc.
      ],
      amountPatterns: [
        /Order Total[^₹Rs\d]*(?:₹|Rs\.?)\s*([\d,.]+)/i,
        /Total[^₹Rs\d]*(?:₹|Rs\.?)\s*([\d,.]+)/i,
        /Grand Total[^₹Rs\d]*(?:₹|Rs\.?)\s*([\d,.]+)/i,
      ],
      itemPatterns: [/([\w\s-]{4,})\s*(?:₹|Rs\.?)\s*([\d,.]+)/g],
      statusKeywords: {
        delivered: ["delivered", "successfully delivered"],
        shipped: ["shipped", "dispatched"],
        confirmed: ["confirmed", "order placed", "order confirmed"],
        cancelled: ["cancelled", "canceled", "refund initiated"],
      },
      addressPatterns: [
        /(?:Delivery Address|Shipping Address|Ship to)[:\s]*([^\n]+)/i,
      ],
      trackingPatterns: [
        /Tracking ID[:\s]*([A-Z0-9]+)/i,
        /AWB[:\s]*([A-Z0-9]+)/i,
      ],
    },
    {
      name: "flipkart",
      displayName: "Flipkart",
      senderPatterns: ["flipkart.com"],
      // FIXED: Added more subject patterns
      subjectPatterns: [
        "your order",
        "order confirmation",
        "order id",
        "shipped", // Added for shipped emails
        "delivered", // Added for delivered emails
        "order", // Generic pattern
      ],
      orderIdPatterns: [
        /Order ID\s*([A-Z0-9]+)/i,
        /Order\s+#?\s*([A-Z0-9-]+)/i,
      ],
      amountPatterns: [
        /Amount Paid[:\s]*₹\s*([\d,]+)/i,
        /Grand Total[:\s]*₹\s*([\d,]+)/i,
        /Total Paid[:\s]*₹\s*([\d,]+)/i,
      ],
      itemPatterns: [/([\w\s-]{4,})\s*(?:₹|Rs\.?)\s*([\d,.]+)/g],
      statusKeywords: {
        delivered: ["delivered"],
        shipped: ["shipped", "out for delivery"],
        confirmed: ["confirmed", "order placed"],
      },
      addressPatterns: [/Delivery Address[:\s]*([^\n]+)/i],
    },
    {
      name: "swiggy",
      displayName: "Swiggy",
      // FIXED: More comprehensive sender patterns
      senderPatterns: ["swiggy.in", "@swiggy", "noreply@swiggy"],
      // FIXED: Better subject patterns that match your actual emails
      subjectPatterns: [
        "instamart order", // Matches "Your Instamart order was successfully delivered"
        "instamart", // Shorter match
        "swiggy", // Original
        "order", // Generic
        "delivered", // Matches delivered emails
        "successfully", // Matches "successfully delivered"
      ],
      // FIXED: Better order ID pattern
      orderIdPatterns: [
        /order id[:\s]*(\d{12,20})/i, // Matches "order id: 213028581143173"
        /order[:\s]*(\d{12,20})/i, // More flexible
        /(\d{12,20})/g, // Fallback for long numbers
      ],
      // FIXED: Better amount patterns
      amountPatterns: [
        /Grand Total[:\s]*₹\s*([\d,]+(?:\.\d+)?)/i,
        /Total[:\s]*₹\s*([\d,]+(?:\.\d+)?)/i,
        /₹\s*([\d,]+(?:\.\d+)?)\s*(?:grand\s*total|total)/i,
      ],
      itemPatterns: [/(\d+)\s*[xX]\s*([\w\s-]+)\s*(?:₹|Rs\.?)?\s*([\d,.]+)?/g],
      statusKeywords: {
        delivered: ["delivered", "successfully delivered"],
        shipped: ["dispatched", "shipped"],
        confirmed: ["order placed", "confirmed"],
      },
      addressPatterns: [/Deliver To[:\s]*([^\n]+)/i],
    },
    // Add more platforms here
  ],

  // ADDED: Configuration for email search and processing
  defaultDaysToFetch: 7,
  maxEmailsPerSync: 50,

  // ADDED: Email search query configuration
  searchQuery: {
    subjects: ["order", "shipped", "delivered", "dispatched", "instamart"],
    excludePromotions: true,
    includeSpam: false,
  },
};
