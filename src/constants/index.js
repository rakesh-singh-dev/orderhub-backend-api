// src/constants/index.js

const fs = require("fs");
const path = require("path");

/**
 * Auto-generate platform constants from discovered parsers
 */
function generatePlatformConstants() {
  const parsersDir = path.join(__dirname, "../services/parsers");
  const platforms = {};

  try {
    const files = fs.readdirSync(parsersDir);

    files.forEach((file) => {
      if (
        file === "index.js" ||
        file === "baseParser.js" ||
        !file.endsWith(".js")
      ) {
        return;
      }

      const platformMatch = file.match(/^(.+)Parser\.js$/);
      if (!platformMatch) return;

      const platform = platformMatch[1].toLowerCase();
      const platformKey = platform.toUpperCase();
      platforms[platformKey] = platform;
    });
  } catch (error) {
    console.error("❌ Error generating platform constants:", error.message);
  }

  return platforms;
}

// Platform constants - Auto-generated from parser files
const PLATFORMS = generatePlatformConstants();

// Order status constants
const ORDER_STATUS = {
  ORDERED: "ordered",
  CONFIRMED: "confirmed",
  PROCESSING: "processing",
  SHIPPED: "shipped",
  OUT_FOR_DELIVERY: "out_for_delivery",
  DELIVERED: "delivered",
  CANCELLED: "cancelled",
  RETURNED: "returned",
  UNKNOWN: "unknown",
};

// Sync status constants
const SYNC_STATUS = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

// Sync type constants
const SYNC_TYPE = {
  MANUAL: "manual",
  AUTOMATIC: "automatic",
  SCHEDULED: "scheduled",
};

// Authentication constants
const AUTH_PROVIDERS = {
  GOOGLE: "google",
  LOCAL: "local",
};

// API response constants
const API_RESPONSES = {
  SUCCESS: "success",
  FAILURE: "failure",
  ERROR: "error",
};

// Email search constants
const EMAIL_SEARCH = {
  DEFAULT_DAYS_TO_FETCH: 7,
  MAX_EMAILS_PER_SYNC: 50,
  BATCH_SIZE: 20,
};

// Database constants
const DB_CONSTRAINTS = {
  MAX_STRING_LENGTH: 255,
  MAX_TEXT_LENGTH: 65535,
  MAX_DECIMAL_PRECISION: 10,
  MAX_DECIMAL_SCALE: 2,
};

// Validation constants
const VALIDATION = {
  MIN_ORDER_AMOUNT: 0,
  MAX_CONFIDENCE_SCORE: 1,
  MIN_CONFIDENCE_SCORE: 0,
  MIN_QUANTITY: 1,
};

// Error messages
const ERROR_MESSAGES = {
  AUTHENTICATION_FAILED: "Authentication failed",
  UNAUTHORIZED: "Unauthorized access",
  RESOURCE_NOT_FOUND: "Resource not found",
  VALIDATION_FAILED: "Validation failed",
  DATABASE_ERROR: "Database operation failed",
  SYNC_FAILED: "Email sync failed",
  TOKEN_EXPIRED: "Token has expired",
  REAUTH_REQUIRED: "Re-authentication required",
  PARSER_NOT_FOUND: "No parser found for this email",
  PLATFORM_NOT_SUPPORTED: "Platform not supported",
};

// Success messages
const SUCCESS_MESSAGES = {
  SYNC_STARTED: "Email sync started successfully",
  ORDER_CREATED: "Order created successfully",
  ORDER_UPDATED: "Order updated successfully",
  ORDER_DELETED: "Order deleted successfully",
  TOKEN_REFRESHED: "Token refreshed successfully",
  LOGOUT_SUCCESS: "Logged out successfully",
  PARSER_DISCOVERED: "Parser discovered successfully",
};

/**
 * Reload platform constants (useful for development)
 */
function reloadPlatformConstants() {
  const newPlatforms = generatePlatformConstants();
  Object.assign(PLATFORMS, newPlatforms);
  console.log(
    `🔄 Reloaded platform constants: ${Object.keys(PLATFORMS).join(", ")}`
  );
}

module.exports = {
  PLATFORMS,
  ORDER_STATUS,
  SYNC_STATUS,
  SYNC_TYPE,
  AUTH_PROVIDERS,
  API_RESPONSES,
  EMAIL_SEARCH,
  DB_CONSTRAINTS,
  VALIDATION,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  // Utility functions
  reloadPlatformConstants,
  generatePlatformConstants,
};
