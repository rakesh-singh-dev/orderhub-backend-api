// backend/src/models/order.js - UPDATED: Removed quick delivery platforms

module.exports = (sequelize, DataTypes) => {
  const Order = sequelize.define(
    "Order",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
      },
      platform: {
        type: DataTypes.ENUM(
          "amazon",
          "flipkart",
          "myntra",
          "nykaa",
          "ajio",
          "meesho",
          "bigbasket",
          "firstcry",
          "tatacliq",
          "snapdeal",
          "paytmmall",
          "reliancedigital",
          "generic",
          "other"
          // REMOVED: "swiggy", "blinkit", "zepto", "dominos"
        ),
        allowNull: false,
      },
      order_id: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      platform_order_id: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: "The actual order ID from the e-commerce platform",
      },
      product_name: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      product_image: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      total_amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0,
        validate: {
          min: 0,
        },
      },
      currency: {
        type: DataTypes.STRING(3),
        defaultValue: "INR",
      },
      order_date: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM(
          "ordered",
          "confirmed",
          "processing",
          "shipped",
          "out_for_delivery",
          "delivered",
          "cancelled",
          "returned",
          "unknown"
        ),
        defaultValue: "ordered",
      },
      tracking_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      expected_delivery: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      delivered_date: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      delivery_address: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      email_message_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      raw_email_data: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      parsed_data: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      tracking_number: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      carrier_name: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      seller_name: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      shipping_address: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      confidence_score: {
        type: DataTypes.DECIMAL(3, 2),
        allowNull: true,
        defaultValue: 0.5,
        validate: {
          min: 0,
          max: 1,
        },
      },
      raw_data: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      email_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      sync_id: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "Unique identifier for sync session",
      },
      last_updated: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
      hash: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      tableName: "orders",
      timestamps: true,
      indexes: [
        {
          fields: ["user_id"],
        },
        {
          fields: ["platform"],
        },
        {
          fields: ["status"],
        },
        {
          fields: ["order_date"],
        },
        {
          fields: ["email_message_id"],
        },
        {
          fields: ["sync_id"],
        },
        {
          unique: true,
          fields: ["user_id", "platform", "platform_order_id"],
        },
      ],
    }
  );

  // Instance methods
  Order.prototype.updateStatus = async function (newStatus) {
    this.status = newStatus;
    this.last_updated = new Date();
    return await this.save();
  };

  Order.prototype.toSummary = function () {
    return {
      id: this.id,
      platform: this.platform,
      order_id: this.order_id,
      platform_order_id: this.platform_order_id,
      product_name: this.product_name,
      total_amount: this.total_amount,
      currency: this.currency,
      order_date: this.order_date,
      status: this.status,
      tracking_id: this.tracking_id,
      item_count: this.OrderItems ? this.OrderItems.length : 0,
    };
  };

  // Class methods
  Order.findByUserAndPlatform = async function (
    userId,
    platform,
    options = {}
  ) {
    // Block quick delivery platforms
    if (["swiggy", "blinkit", "zepto"].includes(platform.toLowerCase())) {
      console.log(
        `⚠️ Platform ${platform} not supported (quick delivery app excluded)`
      );
      return [];
    }

    return await this.findAll({
      where: { user_id: userId, platform },
      include: ["OrderItems"],
      order: [["order_date", "DESC"]],
      ...options,
    });
  };

  Order.getOrderStats = async function (userId, dateRange = {}) {
    const { startDate, endDate } = dateRange;
    const whereClause = {
      user_id: userId,
      // Exclude quick delivery platforms from stats
      platform: {
        [sequelize.Sequelize.Op.notIn]: ["swiggy", "blinkit", "zepto"],
      },
    };

    if (startDate && endDate) {
      whereClause.order_date = {
        [sequelize.Sequelize.Op.between]: [startDate, endDate],
      };
    }

    const stats = await this.findAll({
      where: whereClause,
      attributes: [
        "platform",
        "status",
        [sequelize.fn("COUNT", "*"), "count"],
        [sequelize.fn("SUM", sequelize.col("total_amount")), "total_spent"],
      ],
      group: ["platform", "status"],
      raw: true,
    });

    return stats;
  };

  // Associations
  Order.associate = function (models) {
    Order.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user",
    });

    Order.hasMany(models.OrderItem, {
      foreignKey: "order_id",
      as: "OrderItems",
      onDelete: "CASCADE",
    });
  };

  return Order;
};
