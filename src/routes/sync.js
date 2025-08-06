// backend/src/routes/sync.js - OPTIMIZED STATUS ROUTE
const express = require("express");
const syncService = require("../services/syncService");
const { verifyToken, authenticateJWT } = require("../middleware/auth");
const logger = require("../utils/logger");
const { globalErrorHandler } = require("../middleware/errorHandler");
const { User } = require("../models");
const emailConfig = require("../config/emailConfig");

const router = express.Router();

// Trigger sync
router.post("/trigger", authenticateJWT, async (req, res) => {
  try {
    const options = req.body || {};
    const result = await syncService.syncUserOrders(req.user.id, options);
    return res.status(200).json({
      success: true,
      message: "Sync started",
      data: result,
    });
  } catch (err) {
    logger.error(err);
    if (err.code === "REAUTH_REQUIRED") {
      return res.status(403).json({
        success: false,
        message: err.message || "Re-authorization required",
        action: "REAUTH_REQUIRED",
      });
    }
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to trigger sync",
    });
  }
});
// GET /api/sync/status
router.get("/status", authenticateJWT, async (req, res) => {
  return res.json({
    success: true,
    status: "idle",
    timestamp: new Date().toISOString(),
  });
});

// Get sync status
router.get("/status/:syncId", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return res
        .status(401)
        .json({ success: false, error: "No token provided" });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ success: false, error: "Invalid token" });
    }

    const user = await User.findByPk(decoded.userId);
    if (!user || !user.is_active) {
      return res
        .status(401)
        .json({ success: false, error: "User not found or inactive" });
    }

    const { syncId } = req.params;
    const status = await syncService.getSyncStatus(user.id, syncId);

    res.json({ success: true, status });
  } catch (error) {
    logger.error("Sync status error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to get sync status",
    });
  }
});

// Get sync history
router.get("/history", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return res
        .status(401)
        .json({ success: false, error: "No token provided" });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ success: false, error: "Invalid token" });
    }

    const user = await User.findByPk(decoded.userId);
    if (!user || !user.is_active) {
      return res
        .status(401)
        .json({ success: false, error: "User not found or inactive" });
    }

    const { limit = 10 } = req.query;
    const history = await syncService.getSyncHistory(user.id, parseInt(limit));

    res.json({ success: true, history });
  } catch (error) {
    logger.error("Sync history error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to get sync history",
    });
  }
});

// Get sync stats
router.get("/stats", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return res
        .status(401)
        .json({ success: false, error: "No token provided" });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ success: false, error: "Invalid token" });
    }

    const user = await User.findByPk(decoded.userId);
    if (!user || !user.is_active) {
      return res
        .status(401)
        .json({ success: false, error: "User not found or inactive" });
    }

    const stats = await syncService.getSyncStats(user.id);

    res.json({ success: true, stats });
  } catch (error) {
    logger.error("Sync stats error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to get sync stats",
    });
  }
});

// Get available sources
router.get("/sources", (req, res) => {
  try {
    const sources = emailConfig.sources;
    res.json({ success: true, sources });
  } catch (error) {
    logger.error("Sources error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to get sources",
    });
  }
});

// Health check
router.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Sync service is healthy",
    timestamp: new Date().toISOString(),
  });
});

// Error handling middleware
router.use(globalErrorHandler);

module.exports = router;
