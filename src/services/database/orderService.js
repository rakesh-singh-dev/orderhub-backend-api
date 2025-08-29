// src/services/database/orderService.js

const { Order, OrderItem, User } = require("../../models");
const { Op } = require("sequelize");
const logger = require("../../utils/logger").createModuleLogger("OrderService");
const { validatePagination } = require("../../utils/validation");

/**
 * Order Database Service
 * Handles all order-related database operations
 */
class OrderService {
  /**
   * Create a new order with items
   */
  async createOrder(orderData, userId) {
    const transaction = await Order.sequelize.transaction();

    try {
      // Create order
      const order = await Order.create(
        {
          user_id: userId,
          platform: orderData.platform,
          platform_order_id: orderData.orderId,
          product_name: orderData.items?.[0]?.name || "Unknown Product",
          product_image: orderData.productImage,
          total_amount: orderData.amount || 0,
          currency: orderData.currency || "INR",
          order_date: orderData.orderDate || new Date(),
          status: orderData.status || "ordered",
          tracking_number: orderData.trackingId,
          carrier_name: orderData.carrierName,
          seller_name: orderData.sellerName,
          delivery_address: orderData.deliveryAddress,
          expected_delivery: orderData.expectedDelivery,
          delivered_date: orderData.deliveredDate,
          confidence_score: orderData.confidenceScore || 0.5,
          email_message_id: orderData.emailMessageId,
          raw_email_data: orderData.rawEmailData,
          parsed_data: orderData.parsedData,
          hash: orderData.hash,
          sync_id: orderData.syncId,
        },
        { transaction }
      );

      // Create order items if provided
      if (orderData.items && orderData.items.length > 0) {
        const orderItems = orderData.items.map((item) => ({
          order_id: order.id,
          name: item.name,
          description: item.description,
          quantity: item.quantity || 1,
          unit_price: item.unit_price || item.price || 0,
          total_price: item.total_price || item.totalPrice || 0,
          image_url: item.image_url || item.imageUrl,
          product_url: item.product_url || item.productUrl,
          sku: item.sku,
          brand: item.brand,
          category: item.category,
          attributes: item.attributes,
        }));

        await OrderItem.bulkCreate(orderItems, { transaction });
      }

      await transaction.commit();

      logger.info("Order created successfully", {
        orderId: order.id,
        platformOrderId: order.platform_order_id,
        userId,
      });

      return order;
    } catch (error) {
      await transaction.rollback();
      logger.error("Error creating order", {
        error: error.message,
        userId,
        orderData: { platform: orderData.platform, orderId: orderData.orderId },
      });
      throw error;
    }
  }

  /**
   * Get orders for user with pagination and filtering
   */
  async getOrders(userId, options = {}) {
    const {
      page = 1,
      limit = 10,
      platform,
      status,
      startDate,
      endDate,
      includeItems = true,
      syncOnly = false,
    } = options;

    const pagination = validatePagination({ page, limit });

    // Build where clause
    const whereClause = { user_id: userId };

    if (platform) {
      whereClause.platform = platform;
    }

    if (status) {
      whereClause.status = status;
    }

    if (startDate && endDate) {
      whereClause.order_date = {
        [Op.between]: [new Date(startDate), new Date(endDate)],
      };
    }

    // If syncOnly is true, get the latest sync ID and filter by it
    if (syncOnly) {
      const latestSync = await Order.findOne({
        where: { user_id: userId },
        attributes: ["sync_id"],
        order: [["created_at", "DESC"]],
        raw: true,
      });

      if (latestSync?.sync_id) {
        whereClause.sync_id = latestSync.sync_id;
      }
    }

    // Build include array
    const includeArray = [];
    if (includeItems) {
      includeArray.push({
        model: OrderItem,
        as: "OrderItems",
        attributes: [
          "id",
          "name",
          "description",
          "quantity",
          "unit_price",
          "total_price",
          "image_url",
          "product_url",
          "sku",
          "brand",
          "category",
          "attributes",
        ],
      });
    }

    // Execute query
    const { count, rows: orders } = await Order.findAndCountAll({
      where: whereClause,
      include: includeArray,
      order: [["created_at", "DESC"]],
      limit: pagination.limit,
      offset: pagination.offset,
      attributes: [
        "id",
        "platform",
        "platform_order_id",
        "product_name",
        "product_image",
        "total_amount",
        "currency",
        "status",
        "order_date",
        "expected_delivery",
        "delivered_date",
        "tracking_number",
        "carrier_name",
        "seller_name",
        "confidence_score",
        "sync_id",
        "created_at",
        "updated_at",
      ],
    });

    logger.info("Orders retrieved successfully", {
      userId,
      count,
      page: pagination.page,
      limit: pagination.limit,
    });

    return {
      orders,
      pagination: {
        ...pagination,
        total: count,
        totalPages: Math.ceil(count / pagination.limit),
      },
    };
  }

  /**
   * Get order by ID with items
   */
  async getOrderById(orderId, userId) {
    const order = await Order.findOne({
      where: { id: orderId, user_id: userId },
      include: [
        {
          model: OrderItem,
          as: "OrderItems",
          attributes: [
            "id",
            "name",
            "description",
            "quantity",
            "unit_price",
            "total_price",
            "image_url",
            "product_url",
            "sku",
            "brand",
            "category",
            "attributes",
          ],
        },
      ],
    });

    if (!order) {
      throw new Error("Order not found");
    }

    logger.info("Order retrieved successfully", {
      orderId,
      userId,
      itemsCount: order.OrderItems?.length || 0,
    });

    return order;
  }

  /**
   * Update order
   */
  async updateOrder(orderId, userId, updateData) {
    const order = await Order.findOne({
      where: { id: orderId, user_id: userId },
    });

    if (!order) {
      throw new Error("Order not found");
    }

    const updatedOrder = await order.update(updateData);

    logger.info("Order updated successfully", {
      orderId,
      userId,
      updatedFields: Object.keys(updateData),
    });

    return updatedOrder;
  }

  /**
   * Delete order
   */
  async deleteOrder(orderId, userId) {
    const order = await Order.findOne({
      where: { id: orderId, user_id: userId },
    });

    if (!order) {
      throw new Error("Order not found");
    }

    await order.destroy();

    logger.info("Order deleted successfully", {
      orderId,
      userId,
    });

    return true;
  }

  /**
   * Search orders
   */
  async searchOrders(userId, searchQuery, options = {}) {
    const { platforms = [], dateRange = {}, limit = 20 } = options;

    const whereClause = {
      user_id: userId,
      [Op.or]: [
        { platform_order_id: { [Op.iLike]: `%${searchQuery}%` } },
        { product_name: { [Op.iLike]: `%${searchQuery}%` } },
        { tracking_number: { [Op.iLike]: `%${searchQuery}%` } },
      ],
    };

    if (platforms.length > 0) {
      whereClause.platform = { [Op.in]: platforms };
    }

    if (dateRange.startDate && dateRange.endDate) {
      whereClause.order_date = {
        [Op.between]: [
          new Date(dateRange.startDate),
          new Date(dateRange.endDate),
        ],
      };
    }

    const orders = await Order.findAll({
      where: whereClause,
      include: [
        {
          model: OrderItem,
          as: "OrderItems",
          attributes: ["id", "name", "quantity", "unit_price"],
        },
      ],
      order: [["order_date", "DESC"]],
      limit,
    });

    logger.info("Orders search completed", {
      userId,
      searchQuery,
      resultsCount: orders.length,
    });

    return orders;
  }

  /**
   * Get order statistics
   */
  async getOrderStats(userId, dateRange = {}) {
    const whereClause = { user_id: userId };

    if (dateRange.startDate && dateRange.endDate) {
      whereClause.order_date = {
        [Op.between]: [
          new Date(dateRange.startDate),
          new Date(dateRange.endDate),
        ],
      };
    }

    const stats = await Order.findAll({
      where: whereClause,
      attributes: [
        "platform",
        "status",
        [Order.sequelize.fn("COUNT", "*"), "count"],
        [
          Order.sequelize.fn("SUM", Order.sequelize.col("total_amount")),
          "total_spent",
        ],
      ],
      group: ["platform", "status"],
      raw: true,
    });

    return stats;
  }

  /**
   * Check if order exists by platform order ID
   */
  async orderExists(userId, platform, platformOrderId) {
    const order = await Order.findOne({
      where: {
        user_id: userId,
        platform,
        platform_order_id: platformOrderId,
      },
      attributes: ["id"],
    });

    return !!order;
  }

  /**
   * Get orders by sync ID
   */
  async getOrdersBySyncId(userId, syncId) {
    const orders = await Order.findAll({
      where: {
        user_id: userId,
        sync_id: syncId,
      },
      include: [
        {
          model: OrderItem,
          as: "OrderItems",
          attributes: ["id", "name", "quantity", "unit_price", "total_price"],
        },
      ],
      order: [["created_at", "DESC"]],
    });

    return orders;
  }
}

module.exports = OrderService;
