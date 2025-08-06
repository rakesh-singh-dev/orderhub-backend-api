// backend/src/server.js - REDUCE LOGGING NOISE
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
require("dotenv").config();

const logger = require("./utils/logger");
const db = require("./models");
const { globalErrorHandler } = require("./middleware/errorHandler");
const { passport } = require("./middleware/auth");
const authRoutes = require("./routes/auth");
const orderRoutes = require("./routes/orders");
const syncRoutes = require("./routes/sync");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", true);

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:19006",
    credentials: true,
  })
);

// Rate limiting
if (process.env.NODE_ENV === "production") {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: "Too many requests from this IP, please try again later.",
  });
  app.use("/api/", limiter);
}

// Body parsing middleware
app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Initialize Passport
app.use(passport.initialize());

// Logging
app.use(
  morgan("combined", {
    stream: { write: (message) => logger.info(message.trim()) },
  })
);

// Health check
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

// Routes
app.use("/auth", authRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/sync", syncRoutes);

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Error handling middleware
app.use(globalErrorHandler);

// Database sync and server start
const startServer = async () => {
  try {
    await db.sequelize.authenticate();
    logger.info("Database connection established successfully.");

    if (process.env.NODE_ENV !== "production") {
      await db.sequelize.sync({ alter: true });
      logger.info("Database synchronized successfully.");
    }

    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || "development"}`);
    });
  } catch (error) {
    logger.error("Unable to start server:", error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully");
  await db.sequelize.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down gracefully");
  await db.sequelize.close();
  process.exit(0);
});

startServer();

module.exports = app;
