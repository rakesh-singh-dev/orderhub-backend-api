// src/services/syncService.js - FINAL VERSION WITH DELIVERY PRIORITY AND CLEAN LOGGING

const GmailService = require("./gmailService");
const { parserFactory } = require("./parsers");
const { getOrderHash } = require("./deduplication");
const { User, Order, OrderItem, EmailSync } = require("../models");
const logger = require("../utils/logger");
const emailConfig = require("../config/emailConfig");
const { ensureFreshGoogleToken } = require("../utils/googleToken");
const { Op } = require("sequelize");

class SyncService {
  constructor() {
    this.gmailService = new GmailService();
  }

  async syncUserOrders(userId, options = {}) {
    let syncRecord = null;
    try {
      const user = await User.findByPk(userId);
      if (!user) throw new Error("User not found");
      if (!user.access_token) throw new Error("User has no access token");

      const refreshResult = await ensureFreshGoogleToken(user);
      if (!refreshResult.ok) {
        const err = new Error("Failed to refresh Google token");
        err.code =
          refreshResult.reason === "INVALID_GRANT" ||
          refreshResult.reason === "NO_REFRESH_TOKEN"
            ? "REAUTH_REQUIRED"
            : "REFRESH_FAILED";
        throw err;
      }

      const daysToFetch =
        options.daysToFetch || emailConfig.defaultDaysToFetch || 7;
      const maxResults =
        options.maxResults || emailConfig.maxEmailsPerSync || 50;

      console.log("🚀 Starting enhanced sync with delivery priority...");
      console.log(
        `📊 Parameters: ${daysToFetch} days, max ${maxResults} emails`
      );

      syncRecord = await EmailSync.create({
        user_id: userId,
        status: "in_progress",
        started_at: new Date(),
        metadata: {
          options,
          strategy: "delivery_priority_with_enhanced_parsing",
          resolvedParameters: { daysToFetch, maxResults },
        },
      });

      const syncId = syncRecord.id;
      logger.info(
        `Starting enhanced sync for user ${user.email} (ID: ${syncId})`
      );

      await this.gmailService.initializeClient(
        user.access_token,
        user.refresh_token
      );

      // Step 1: Get emails from Gmail
      const emails = await this.gmailService.getEmailsFromDateRange(
        daysToFetch,
        maxResults
      );

      if (emails.length === 0) {
        return await this.handleNoEmailsFound(
          syncRecord,
          daysToFetch,
          maxResults
        );
      }

      // Step 2: Fetch email details
      console.log(`📥 Fetching details for ${emails.length} emails...`);
      const emailDetails = await this.gmailService.getEmailDetails(emails);

      // Step 3: 🎯 DELIVERY PRIORITY PROCESSING
      const processResult = await this.processEmailsWithDeliveryPriority(
        emailDetails,
        userId,
        syncId
      );

      // Step 4: Complete sync
      return await this.completeSyncWithResults(
        syncRecord,
        processResult,
        daysToFetch,
        maxResults
      );
    } catch (error) {
      logger.error(`Sync failed for user ${userId}:`, error);
      if (syncRecord) {
        await syncRecord.update({
          status: "failed",
          completed_at: new Date(),
          errors: [
            {
              timestamp: new Date(),
              message: error.message,
              stack: error.stack,
            },
          ],
        });
      }
      throw error;
    }
  }

  /**
   * 🎯 DELIVERY PRIORITY PROCESSING: Process emails by type priority
   */
  async processEmailsWithDeliveryPriority(emailDetails, userId, syncId) {
    console.log(
      `\n🎯 Processing ${emailDetails.length} emails with delivery priority...`
    );

    const results = {
      ordersCreated: 0,
      ordersUpdated: 0,
      ordersSkipped: 0,
      parsingErrors: 0,
      emailsProcessed: 0,
      processedOrders: [],
      skippedEmails: [],
      errorEmails: [],
      totalLinksFound: 0,
      platformStats: {},
      deliveryUpdatesApplied: 0,
    };

    // Step 1: Parse and categorize emails
    const categorizedEmails = await this.parseAndCategorizeEmails(emailDetails);

    console.log(`📊 Email categories:`);
    console.log(
      `   📋 Confirmations: ${categorizedEmails.orderConfirmations.length}`
    );
    console.log(
      `   📦 Shipping: ${categorizedEmails.shippingNotifications.length}`
    );
    console.log(
      `   🏠 Delivery: ${categorizedEmails.deliveryNotifications.length}`
    );
    console.log(`   📧 Other: ${categorizedEmails.otherNotifications.length}`);

    results.emailsProcessed = emailDetails.length;
    results.parsingErrors = categorizedEmails.parsingErrors;

    // Step 2: Process order confirmations (create new orders)
    if (categorizedEmails.orderConfirmations.length > 0) {
      console.log(
        `\n📋 Processing ${categorizedEmails.orderConfirmations.length} order confirmations...`
      );
      const confirmationResult = await this.processOrderEmailsByPriority(
        categorizedEmails.orderConfirmations,
        userId,
        syncId
      );
      this.mergeResults(results, confirmationResult);
    }

    // Step 3: Process shipping notifications (create/update orders)
    if (categorizedEmails.shippingNotifications.length > 0) {
      console.log(
        `\n📦 Processing ${categorizedEmails.shippingNotifications.length} shipping notifications...`
      );
      const shippingResult = await this.processOrderEmailsByPriority(
        categorizedEmails.shippingNotifications,
        userId,
        syncId
      );
      this.mergeResults(results, shippingResult);
    }

    // Step 4: Process other notifications
    if (categorizedEmails.otherNotifications.length > 0) {
      console.log(
        `\n📧 Processing ${categorizedEmails.otherNotifications.length} other notifications...`
      );
      const otherResult = await this.processOrderEmailsByPriority(
        categorizedEmails.otherNotifications,
        userId,
        syncId
      );
      this.mergeResults(results, otherResult);
    }

    // Step 5: 🏠 Process delivery notifications LAST (status updates only)
    if (categorizedEmails.deliveryNotifications.length > 0) {
      console.log(
        `\n🏠 Processing ${categorizedEmails.deliveryNotifications.length} delivery notifications...`
      );
      const deliveryResult = await this.processDeliveryNotificationsOnly(
        categorizedEmails.deliveryNotifications,
        userId,
        syncId
      );
      this.mergeResults(results, deliveryResult);
      results.deliveryUpdatesApplied =
        deliveryResult.deliveryUpdatesApplied || 0;
    }

    console.log(
      `\n✅ Processing complete: ${results.ordersCreated} created, ${results.ordersUpdated} updated, ${results.deliveryUpdatesApplied} delivery updates`
    );

    return results;
  }

  /**
   * 📧 Parse and categorize emails by type
   */
  async parseAndCategorizeEmails(emailDetails) {
    const categorized = {
      orderConfirmations: [],
      shippingNotifications: [],
      deliveryNotifications: [],
      otherNotifications: [],
      parsingErrors: 0,
    };

    for (let i = 0; i < emailDetails.length; i++) {
      const email = emailDetails[i];

      try {
        const parsedData = this.parseEmailWithValidation(email);

        if (parsedData) {
          const emailWithMetadata = {
            ...parsedData,
            originalEmail: email,
            emailIndex: i + 1,
            emailTimestamp: parseInt(email.internalDate || 0),
          };

          switch (parsedData.emailType) {
            case "order_confirmation":
              categorized.orderConfirmations.push(emailWithMetadata);
              break;
            case "shipping_notification":
              categorized.shippingNotifications.push(emailWithMetadata);
              break;
            case "delivery_notification":
            case "out_for_delivery":
              categorized.deliveryNotifications.push(emailWithMetadata);
              break;
            default:
              categorized.otherNotifications.push(emailWithMetadata);
              break;
          }
        } else {
          categorized.parsingErrors++;
        }
      } catch (error) {
        categorized.parsingErrors++;
      }
    }

    return categorized;
  }

  /**
   * 🏠 Process delivery notifications: Update existing orders only
   */
  async processDeliveryNotificationsOnly(deliveryEmails, userId, syncId) {
    const results = {
      ordersUpdated: 0,
      ordersSkipped: 0,
      deliveryUpdatesApplied: 0,
      processedOrders: [],
      skippedEmails: [],
      errorEmails: [],
    };

    for (const deliveryEmail of deliveryEmails) {
      const orderId = deliveryEmail.orderId;

      try {
        // Find existing order
        const existingOrder = await this.findExistingOrderForDelivery(
          userId,
          deliveryEmail.platform,
          deliveryEmail
        );

        if (existingOrder) {
          // Update delivery status
          const shouldUpdate = this.shouldUpdateDeliveryStatus(
            existingOrder.status,
            deliveryEmail.status
          );

          if (shouldUpdate) {
            const updates = {
              status: deliveryEmail.status,
              delivered_date: new Date(),
              last_updated: new Date(),
              sync_id: syncId,
            };

            // Add tracking if missing
            if (deliveryEmail.trackingId && !existingOrder.tracking_number) {
              updates.tracking_number = deliveryEmail.trackingId;
            }

            await existingOrder.update(updates);

            results.ordersUpdated++;
            results.deliveryUpdatesApplied++;
            results.processedOrders.push(await existingOrder.reload());
          } else {
            results.ordersSkipped++;
          }
        } else {
          // 🎯 KEY DECISION: Skip delivery notifications without existing orders
          console.log(
            `⏭️ Skipping delivery notification for ${orderId} - no existing order`
          );

          results.skippedEmails.push({
            orderId: orderId,
            reason: "delivery_notification_without_existing_order",
            emailType: deliveryEmail.emailType,
            decision: "skipped - no product information available",
          });

          results.ordersSkipped++;
        }
      } catch (error) {
        console.error(
          `❌ Error processing delivery notification: ${error.message}`
        );
        results.errorEmails.push({
          error: error.message,
          orderId: orderId,
          emailType: deliveryEmail.emailType,
        });
      }
    }

    return results;
  }

  /**
   * 🔍 Find existing order for delivery notification
   */
  async findExistingOrderForDelivery(userId, platform, deliveryEmail) {
    const searchConditions = [];

    if (deliveryEmail.orderId) {
      searchConditions.push({ platform_order_id: deliveryEmail.orderId });
    }

    if (deliveryEmail.trackingId) {
      searchConditions.push({ tracking_number: deliveryEmail.trackingId });
    }

    if (deliveryEmail.orderId) {
      const hash = getOrderHash({
        platform,
        orderId: deliveryEmail.orderId,
        userId,
      });
      searchConditions.push({ hash });
    }

    if (searchConditions.length === 0) return null;

    return await Order.findOne({
      where: {
        user_id: userId,
        platform: platform,
        [Op.or]: searchConditions,
      },
    });
  }

  /**
   * 📊 Process order emails by priority (non-delivery emails)
   */
  async processOrderEmailsByPriority(emails, userId, syncId) {
    // Group by platform
    const platformGroups = this.groupOrdersByPlatform(emails);

    const results = {
      ordersCreated: 0,
      ordersUpdated: 0,
      ordersSkipped: 0,
      processedOrders: [],
      skippedEmails: [],
      errorEmails: [],
    };

    // Process each platform
    for (const [platform, platformOrders] of Object.entries(platformGroups)) {
      if (platformOrders.length === 0) continue;

      // Link orders for this platform
      const linkedOrders = await this.linkOrdersForPlatformFixed(
        platform,
        platformOrders
      );

      // Process linked orders
      const platformResult =
        await this.processLinkedOrdersWithFixedLifecycleProtection(
          linkedOrders,
          platform,
          userId,
          syncId
        );

      this.mergeResults(results, platformResult);
    }

    return results;
  }

  /**
   * 🪙 Group parsed orders by platform
   */
  groupOrdersByPlatform(parsedOrders) {
    const groups = {};
    for (const order of parsedOrders) {
      const platform = order.platform || "generic";
      if (!groups[platform]) groups[platform] = [];
      groups[platform].push(order);
    }
    return groups;
  }

  /**
   * 🔗 Link orders for platform with enhanced logic
   */
  async linkOrdersForPlatformFixed(platform, platformOrders) {
    if (platformOrders.length === 0) return [];

    // For Myntra, use enhanced linking
    if (platform === "myntra") {
      return await this.linkMyntraOrdersRobustly(platformOrders);
    }

    // For other platforms, use fixed standard linking
    return await this.linkOrdersFixedStandard(platform, platformOrders);
  }

  /**
   * 🔗 Fixed standard linking with proper key generation
   */
  async linkOrdersFixedStandard(platform, platformOrders) {
    if (platformOrders.length === 0) return [];

    // Group orders by fixed order key
    const orderGroups = new Map();

    for (const order of platformOrders) {
      const orderKey = this.generateFixedOrderKey(order, platform);
      if (!orderGroups.has(orderKey)) {
        orderGroups.set(orderKey, []);
      }
      orderGroups.get(orderKey).push(order);
    }

    // Process each group
    const linkedOrders = [];

    for (const [orderKey, orderGroup] of orderGroups) {
      if (orderGroup.length === 1) {
        linkedOrders.push(orderGroup[0]);
      } else {
        const linkedOrder = this.createFixedUniversalLinkedOrder(
          orderGroup,
          platform
        );
        linkedOrders.push(linkedOrder);
      }
    }

    return linkedOrders;
  }

  /**
   * 🔑 Generate fixed order key that prevents wrong grouping
   */
  generateFixedOrderKey(order, platform) {
    // 🎯 PRIMARY: Use order ID as unique identifier
    if (order.orderId) {
      return `${platform}_orderid_${order.orderId}`;
    }

    // 🎯 SECONDARY: Use tracking ID if no order ID
    if (order.trackingId) {
      return `${platform}_tracking_${order.trackingId}`;
    }

    // 🎯 FALLBACK: Product-based key only when no IDs available
    const identifiers = [platform];

    const productName = order.products?.[0]?.name || "unknown";
    const normalizedProduct = this.cleanProductNameForKey(productName);
    identifiers.push(normalizedProduct);

    const amount = order.amount ? Math.round(order.amount) : 0;
    identifiers.push(amount.toString());

    const addressId = this.getFlexibleAddressId(order);
    identifiers.push(addressId);

    const orderDate = order.orderDate || new Date();
    const dayKey = orderDate.toISOString().split("T")[0].replace(/-/g, "");
    identifiers.push(dayKey);

    return identifiers.join("_");
  }

  /**
   * 🔗 Create fixed universal linked order
   */
  createFixedUniversalLinkedOrder(orderGroup, platform) {
    // For Myntra, use specific method
    if (platform === "myntra") {
      return this.createMyntraLinkedOrder(orderGroup);
    }

    // Sort emails by lifecycle stage
    const sortedOrders = this.sortOrdersByLifecycleStage(orderGroup);

    // Build timeline
    const orderTimeline = this.buildOrderTimeline(sortedOrders);

    // Create master order with enhanced data preservation
    const masterOrder = this.mergeFixedMasterOrderData(sortedOrders, platform);

    // Add lifecycle protection metadata
    masterOrder.lifecycleProtection = {
      emailsLinked: orderGroup.length,
      timeline: orderTimeline,
      integrityChecks: this.performIntegrityChecks(sortedOrders),
      linkedAt: new Date().toISOString(),
      linkingStrategy: "fixed_universal",
    };

    return masterOrder;
  }

  /**
   * 🔗 Merge master order data with enhanced preservation
   */
  mergeFixedMasterOrderData(sortedOrders, platform) {
    // Find the order with best data quality
    const baseOrder = this.selectBestOrderForMerging(sortedOrders);
    const masterOrder = { ...baseOrder };

    let bestProductName = baseOrder.products?.[0]?.name;
    let bestAmount = baseOrder.amount;

    // Merge data from all orders with priority preservation
    for (const order of sortedOrders) {
      // Order ID merging
      if (!masterOrder.orderId && order.orderId) {
        masterOrder.orderId = order.orderId;
      }

      // Tracking ID merging
      if (!masterOrder.trackingId && order.trackingId) {
        masterOrder.trackingId = order.trackingId;
      }

      // Amount preservation - prefer non-zero amounts
      if (
        (!masterOrder.amount || masterOrder.amount === 0) &&
        order.amount &&
        order.amount > 0
      ) {
        masterOrder.amount = order.amount;
        bestAmount = order.amount;
      }

      // Product name preservation with quality check
      if (order.products && order.products.length > 0) {
        const newProductName = order.products[0].name;
        if (this.isProductNameBetter(bestProductName, newProductName)) {
          bestProductName = newProductName;
          masterOrder.products = order.products;
        }
      }

      // Status update with lifecycle protection
      if (this.shouldUpdateStatus(masterOrder.status, order.status)) {
        masterOrder.status = order.status;
      }

      // Delivery address
      if (!masterOrder.deliveryAddress && order.deliveryAddress) {
        masterOrder.deliveryAddress = order.deliveryAddress;
      }
    }

    // Final data preservation
    if (bestProductName && masterOrder.products) {
      masterOrder.products[0].name = bestProductName;
      if (bestAmount && bestAmount > 0 && masterOrder.products.length === 1) {
        masterOrder.products[0].price = bestAmount;
        masterOrder.products[0].formattedPrice = `₹${bestAmount}`;
      }
    }

    if (bestAmount && bestAmount > 0) {
      masterOrder.amount = bestAmount;
      masterOrder.formattedAmount = `₹${bestAmount}`;
    }

    // Add linking metadata
    masterOrder.isLinkedOrder = sortedOrders.length > 1;
    masterOrder.linkedEmailCount = sortedOrders.length;
    masterOrder.linkedEmails = sortedOrders.map((order) => ({
      emailIndex: order.emailIndex,
      emailType: order.emailType,
      status: order.status,
      orderId: order.orderId,
      trackingId: order.trackingId,
      subject: order.originalEmail.headers.subject,
      timestamp: order.emailTimestamp,
      productName: order.products?.[0]?.name,
      amount: order.amount,
    }));

    masterOrder.confidence = Math.min(
      (masterOrder.confidence || 0.7) + sortedOrders.length * 0.05,
      0.95
    );

    return masterOrder;
  }

  /**
   * 🛡️ Process linked orders with enhanced lifecycle protection
   */
  async processLinkedOrdersWithFixedLifecycleProtection(
    linkedOrders,
    platform,
    userId,
    syncId
  ) {
    const results = {
      ordersCreated: 0,
      ordersUpdated: 0,
      ordersSkipped: 0,
      processedOrders: [],
      skippedEmails: [],
      errorEmails: [],
    };

    for (const linkedOrder of linkedOrders) {
      try {
        // Find existing order
        const existingOrder = await this.findExistingOrderUniversal(
          userId,
          platform,
          linkedOrder
        );

        if (existingOrder) {
          const updatedOrder =
            await this.updateExistingOrderWithFixedLifecycleProtection(
              existingOrder,
              linkedOrder,
              syncId
            );
          results.ordersUpdated++;
          results.processedOrders.push(updatedOrder);
        } else {
          const newOrder = await this.createNewFixedLinkedOrder(
            linkedOrder,
            userId,
            syncId
          );
          results.ordersCreated++;
          results.processedOrders.push(newOrder);
        }
      } catch (error) {
        console.error(`❌ Error processing linked order: ${error.message}`);
        results.errorEmails.push({
          error: error.message,
          platform,
          orderData: {
            orderId: linkedOrder.orderId,
            trackingId: linkedOrder.trackingId,
          },
        });
      }
    }

    return results;
  }

  /**
   * ✅ Create new fixed linked order
   */
  async createNewFixedLinkedOrder(linkedOrderData, userId, syncId) {
    const finalProductName = this.getFixedCleanProductName(linkedOrderData);
    const finalAmount = linkedOrderData.amount || 0;

    const orderData = {
      user_id: userId,
      platform: linkedOrderData.platform,
      order_id: linkedOrderData.orderId || linkedOrderData.trackingId,
      platform_order_id: linkedOrderData.orderId || linkedOrderData.trackingId,
      product_name: finalProductName,
      total_amount: finalAmount,
      currency: "INR",
      order_date: linkedOrderData.orderDate || new Date(),
      status: linkedOrderData.status || "ordered",
      tracking_number: linkedOrderData.trackingId || null,
      delivered_date:
        linkedOrderData.status === "delivered" ? new Date() : null,
      email_message_id: linkedOrderData.originalEmail?.messageId,
      raw_email_data: JSON.stringify({
        linkedEmails: linkedOrderData.linkedEmails,
        isLinkedOrder: linkedOrderData.isLinkedOrder,
        lifecycleProtection: linkedOrderData.lifecycleProtection,
        originalParsedData: {
          productName: finalProductName,
          amount: finalAmount,
          extractionMetadata: linkedOrderData.extractionMetadata,
        },
      }),
      parsed_data: linkedOrderData,
      confidence_score: linkedOrderData.confidence || 0.8,
      sync_id: syncId,
      last_updated: new Date(),
      hash: getOrderHash({
        platform: linkedOrderData.platform,
        orderId: linkedOrderData.orderId || linkedOrderData.trackingId,
        userId,
      }),
    };

    const order = await Order.create(orderData);

    // Create order items with preserved pricing
    if (linkedOrderData.products && linkedOrderData.products.length > 0) {
      await this.createOrderItemsFixed(
        order.id,
        linkedOrderData.products,
        finalAmount
      );
    }

    return order;
  }

  /**
   * 📄 Update existing order with enhanced preservation
   */
  async updateExistingOrderWithFixedLifecycleProtection(
    existingOrder,
    linkedOrder,
    syncId
  ) {
    const updates = {};
    const changes = [];

    // Product name updates
    if (linkedOrder.products && linkedOrder.products.length > 0) {
      const newProductName = linkedOrder.products[0].name;
      if (
        this.isProductNameBetter(existingOrder.product_name, newProductName)
      ) {
        updates.product_name = newProductName;
        changes.push(`product: "${newProductName?.substring(0, 30)}"`);
      }
    }

    // Amount updates
    if (linkedOrder.amount && linkedOrder.amount > 0) {
      if (!existingOrder.total_amount || existingOrder.total_amount === 0) {
        updates.total_amount = linkedOrder.amount;
        changes.push(`amount: ₹${linkedOrder.amount}`);
      }
    }

    // Order ID updates
    if (!existingOrder.platform_order_id && linkedOrder.orderId) {
      updates.platform_order_id = linkedOrder.orderId;
      updates.order_id = linkedOrder.orderId;
      changes.push(`order_id: ${linkedOrder.orderId}`);
    }

    // Tracking updates
    if (linkedOrder.trackingId && !existingOrder.tracking_number) {
      updates.tracking_number = linkedOrder.trackingId;
      changes.push(`tracking: ${linkedOrder.trackingId}`);
    }

    // Status updates
    if (this.shouldUpdateStatus(existingOrder.status, linkedOrder.status)) {
      updates.status = linkedOrder.status;
      changes.push(`status: ${existingOrder.status} → ${linkedOrder.status}`);

      if (linkedOrder.status === "delivered" && !existingOrder.delivered_date) {
        updates.delivered_date = new Date();
        changes.push("delivery_date: added");
      }
    }

    // Update metadata
    updates.sync_id = syncId;
    updates.last_updated = new Date();
    updates.parsed_data = {
      ...(existingOrder.parsed_data || {}),
      linkedOrderData: linkedOrder,
      lifecycleProtection: linkedOrder.lifecycleProtection,
    };

    if (changes.length > 0) {
      await existingOrder.update(updates);
      return await existingOrder.reload();
    }

    return existingOrder;
  }

  /**
   * 🔧 Get clean product name with enhanced fallback
   */
  getFixedCleanProductName(parsedData) {
    // Priority 1: Use products array with quality check
    if (parsedData.products && parsedData.products.length > 0) {
      for (const product of parsedData.products) {
        const productName = product.name;

        if (
          productName &&
          productName !== "Data not available in email" &&
          productName.length > 3 &&
          !this.isGarbageProductName(productName) &&
          !productName.includes("Amazon Order") &&
          !productName.includes("Delivered Item") &&
          !productName.includes("Out for Delivery")
        ) {
          return productName.length > 100
            ? productName.substring(0, 100) + "..."
            : productName;
        }
      }
    }

    // Priority 2: Extract from original email subject
    if (parsedData.originalEmail?.headers?.subject) {
      const subjectProduct = this.extractGenericProductFromSubject(
        parsedData.originalEmail.headers.subject
      );
      if (subjectProduct) {
        return subjectProduct;
      }
    }

    // Fallback: Create meaningful name
    const platform =
      parsedData.platform.charAt(0).toUpperCase() +
      parsedData.platform.slice(1);
    const orderId = parsedData.orderId || parsedData.trackingId || "Unknown";

    if (parsedData.emailType === "delivery_notification") {
      return `${platform} Delivered Item ${orderId}`;
    } else if (parsedData.emailType === "shipping_notification") {
      return `${platform} Shipped Item ${orderId}`;
    } else {
      return `${platform} Order ${orderId}`;
    }
  }

  /**
   * 🎯 Select best order for merging based on data quality
   */
  selectBestOrderForMerging(orders) {
    const scoredOrders = orders.map((order) => {
      let score = 0;

      // Product name quality (highest priority)
      if (order.products && order.products.length > 0) {
        const productName = order.products[0].name || "";
        if (
          productName &&
          !productName.startsWith("Amazon Order") &&
          !productName.includes("Delivered Item") &&
          !productName.includes("Data not available")
        ) {
          score += 50;
          if (productName.length > 15) score += 10;
          if (productName.split(" ").length >= 3) score += 10;
        }
      }

      // Amount availability
      if (order.amount && order.amount > 0) {
        score += 30;
      }

      // Order ID availability
      if (order.orderId) {
        score += 15;
      }

      // Email type quality
      if (order.emailType === "order_confirmation") {
        score += 10;
      } else if (order.emailType === "shipping_notification") {
        score += 5;
      }

      // Confidence score
      score += (order.confidence || 0) * 10;

      return { order, score };
    });

    scoredOrders.sort((a, b) => b.score - a.score);
    return scoredOrders[0].order;
  }

  /**
   * 🔧 Check if new product name is better
   */
  isProductNameBetter(currentName, newName) {
    if (!currentName) return !!newName;
    if (!newName) return false;

    // Current name is placeholder/generic
    if (
      currentName.includes("Amazon Order") ||
      currentName.includes("Delivered Item") ||
      currentName.includes("Out for Delivery") ||
      currentName.includes("Flipkart Order") ||
      currentName.includes("Myntra Order") ||
      currentName === "Data not available in email"
    ) {
      return (
        !newName.includes("Amazon Order") &&
        !newName.includes("Delivered Item") &&
        !newName.includes("Out for Delivery") &&
        !newName.includes("Flipkart Order") &&
        !newName.includes("Myntra Order") &&
        newName !== "Data not available in email"
      );
    }

    // New name is placeholder/generic
    if (
      newName.includes("Amazon Order") ||
      newName.includes("Delivered Item") ||
      newName.includes("Out for Delivery") ||
      newName.includes("Flipkart Order") ||
      newName.includes("Myntra Order") ||
      newName === "Data not available in email"
    ) {
      return false;
    }

    // Both are real names - prefer longer, more descriptive one
    const currentWords = currentName.split(" ").length;
    const newWords = newName.split(" ").length;

    return newWords > currentWords && newName.length > currentName.length;
  }

  /**
   * 🔧 Create order items with proper pricing
   */
  async createOrderItemsFixed(orderId, products, totalAmount = null) {
    const validItems = products.filter(
      (item) =>
        item.name &&
        item.name !== "Data not available in email" &&
        item.name.length > 3 &&
        !this.isGarbageProductName(item.name)
    );

    if (validItems.length === 0) return;

    const itemsToCreate = validItems.map((item) => {
      let itemPrice = 0;
      let itemTotalPrice = 0;

      if (item.price && typeof item.price === "number" && item.price > 0) {
        itemPrice = item.price;
        itemTotalPrice = itemPrice * (parseInt(item.quantity) || 1);
      } else if (totalAmount && totalAmount > 0) {
        if (validItems.length === 1) {
          itemPrice = totalAmount;
          itemTotalPrice = totalAmount;
        } else {
          itemPrice = Math.round(totalAmount / validItems.length);
          itemTotalPrice = itemPrice * (parseInt(item.quantity) || 1);
        }
      }

      return {
        order_id: orderId,
        name: item.name,
        description: item.description || null,
        quantity: parseInt(item.quantity) || 1,
        unit_price: itemPrice,
        total_price: itemTotalPrice,
        image_url: item.image_url || null,
        product_url: item.product_url || null,
        sku: item.sku || null,
        brand: item.brand || null,
        category: item.category || null,
        attributes: item.attributes || null,
      };
    });

    await OrderItem.bulkCreate(itemsToCreate);
  }

  /**
   * 🔍 Find existing order for universal matching
   */
  async findExistingOrderUniversal(userId, platform, linkedOrder) {
    const orConditions = [];

    if (linkedOrder.orderId) {
      orConditions.push({ platform_order_id: linkedOrder.orderId });
    }

    if (linkedOrder.trackingId) {
      orConditions.push({ tracking_number: linkedOrder.trackingId });
      orConditions.push({ platform_order_id: linkedOrder.trackingId });
    }

    if (linkedOrder.orderId || linkedOrder.trackingId) {
      const hash = getOrderHash({
        platform,
        orderId: linkedOrder.orderId || linkedOrder.trackingId,
        userId,
      });
      orConditions.push({ hash });
    }

    if (orConditions.length === 0) return null;

    return await Order.findOne({
      where: {
        user_id: userId,
        platform: platform,
        [Op.or]: orConditions,
      },
    });
  }

  /**
   * 🔧 Check if delivery status should be updated
   */
  shouldUpdateDeliveryStatus(currentStatus, newStatus) {
    const statusHierarchy = {
      ordered: 1,
      confirmed: 2,
      processing: 3,
      shipped: 4,
      out_for_delivery: 5,
      delivered: 6,
    };

    const currentLevel = statusHierarchy[currentStatus] || 1;
    const newLevel = statusHierarchy[newStatus] || 1;

    return newLevel >= currentLevel;
  }

  // 🔧 HELPER METHODS

  cleanProductNameForKey(productName) {
    if (!productName) return "unknown";

    return productName
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#8377;/g, "₹")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .substring(0, 50);
  }

  getFlexibleAddressId(order) {
    if (order.deliveryAddress?.pincode) {
      return order.deliveryAddress.pincode;
    }

    if (order.deliveryAddress?.city) {
      return order.deliveryAddress.city.toLowerCase().replace(/\s+/g, "_");
    }

    return "user_default";
  }

  extractGenericProductFromSubject(subject) {
    if (!subject) return null;

    const patterns = [
      /"([^"]{8,80})"/i,
      /:\s*([A-Z][a-zA-Z0-9\s\-&.'()]{8,80})(?:\.\.\.|\s+-\s+|$)/i,
      /containing\s*(.{8,60})/i,
      /for\s+(.{8,60})\s+has\s+been/i,
    ];

    for (const pattern of patterns) {
      const match = subject.match(pattern);
      if (match) {
        const productName = match[1].trim();
        const cleanName = this.cleanProductNameForDisplay(productName);

        if (this.isValidProductNameForDisplay(cleanName)) {
          return cleanName;
        }
      }
    }

    return null;
  }

  cleanProductNameForDisplay(name) {
    if (!name) return "";

    return name
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#8377;/g, "₹")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .replace(/[<>]/g, "")
      .replace(/^\W+|\W+$/g, "")
      .replace(/\.{3,}/, "...")
      .substring(0, 100)
      .trim();
  }

  isValidProductNameForDisplay(name) {
    if (!name || name.length < 3 || name.length > 120) return false;

    const nameLower = name.toLowerCase().trim();

    const rejectPatterns = [
      /^(amazon|flipkart|myntra|order|delivered|shipped|confirmation|notification|email|package|item|shipment)$/i,
      /^(your|the|this|that|has|been|was|will|can|may|should|dear|hello|hi|thanks|thank|regarding)$/i,
      /^\d+$/,
      /^[\d\s\-\.]+$/,
      /^[a-f0-9]{8,}$/i,
      /http|www\.|\.com|\.in|mailto|@/i,
    ];

    const isRejected = rejectPatterns.some((pattern) =>
      pattern.test(nameLower)
    );
    return !isRejected && /[a-zA-Z]{3,}/.test(name);
  }

  mergeResults(targetResults, sourceResults) {
    targetResults.ordersCreated += sourceResults.ordersCreated || 0;
    targetResults.ordersUpdated += sourceResults.ordersUpdated || 0;
    targetResults.ordersSkipped += sourceResults.ordersSkipped || 0;
    targetResults.processedOrders.push(
      ...(sourceResults.processedOrders || [])
    );
    targetResults.skippedEmails.push(...(sourceResults.skippedEmails || []));
    targetResults.errorEmails.push(...(sourceResults.errorEmails || []));

    if (sourceResults.deliveryUpdatesApplied) {
      targetResults.deliveryUpdatesApplied =
        (targetResults.deliveryUpdatesApplied || 0) +
        sourceResults.deliveryUpdatesApplied;
    }
  }

  // 🔧 MYNTRA METHODS (unchanged but with reduced logging)

  async linkMyntraOrdersRobustly(myntraOrders) {
    const validOrders = myntraOrders.filter(
      (order) =>
        order.orderId ||
        order.trackingId ||
        (order.products && order.products.length > 0)
    );

    if (validOrders.length === 0) return [];

    const orderGroups = new Map();

    for (const order of validOrders) {
      const orderKey = this.generateFixedOrderKey(order, "myntra");
      if (!orderGroups.has(orderKey)) {
        orderGroups.set(orderKey, []);
      }
      orderGroups.get(orderKey).push(order);
    }

    const enhancedGroups = this.enhanceMyntraLinkingFlexible(
      orderGroups,
      validOrders
    );

    const linkedOrders = [];

    for (const [orderKey, orderGroup] of enhancedGroups) {
      if (orderGroup.length === 1) {
        linkedOrders.push(orderGroup[0]);
      } else {
        const linkedOrder = this.createMyntraLinkedOrder(orderGroup);
        linkedOrders.push(linkedOrder);
      }
    }

    return linkedOrders;
  }

  enhanceMyntraLinkingFlexible(existingGroups, allOrders) {
    const singleOrderGroups = [];
    const multiOrderGroups = [];

    for (const [key, group] of existingGroups) {
      if (group.length === 1) {
        singleOrderGroups.push({ key, group });
      } else {
        multiOrderGroups.push({ key, group });
      }
    }

    const newGroups = new Map(existingGroups);
    const processedKeys = new Set();

    for (let i = 0; i < singleOrderGroups.length; i++) {
      if (processedKeys.has(singleOrderGroups[i].key)) continue;

      const group1 = singleOrderGroups[i];
      const order1 = group1.group[0];

      for (let j = i + 1; j < singleOrderGroups.length; j++) {
        if (processedKeys.has(singleOrderGroups[j].key)) continue;

        const group2 = singleOrderGroups[j];
        const order2 = group2.group[0];

        if (this.shouldLinkMyntraOrders(order1, order2)) {
          newGroups.delete(group1.key);
          newGroups.delete(group2.key);
          processedKeys.add(group1.key);
          processedKeys.add(group2.key);

          const combinedKey = `linked_${group1.key.split("_")[1]}_${
            order1.amount || 0
          }`;
          newGroups.set(combinedKey, [order1, order2]);
          break;
        }
      }
    }

    return newGroups;
  }

  shouldLinkMyntraOrders(order1, order2) {
    const productSimilarity = this.calculateProductSimilarity(order1, order2);
    if (productSimilarity < 85) return false;

    const amount1 = order1.amount || 0;
    const amount2 = order2.amount || 0;
    const amountDiff = Math.abs(amount1 - amount2);
    if (amountDiff > 1) return false;

    const date1 = order1.orderDate || new Date();
    const date2 = order2.orderDate || new Date();
    const dateDiff = Math.abs(date1.getTime() - date2.getTime());
    const oneDayMs = 24 * 60 * 60 * 1000;
    if (dateDiff > oneDayMs) return false;

    return true;
  }

  calculateProductSimilarity(order1, order2) {
    const name1 = this.cleanProductNameForKey(order1.products?.[0]?.name || "");
    const name2 = this.cleanProductNameForKey(order2.products?.[0]?.name || "");

    if (!name1 || !name2) return 0;

    const words1 = name1.split("_").filter((w) => w.length > 2);
    const words2 = name2.split("_").filter((w) => w.length > 2);

    const commonWords = words1.filter((word) => words2.includes(word));
    const totalUniqueWords = new Set([...words1, ...words2]).size;

    return Math.round(((commonWords.length * 2) / totalUniqueWords) * 100);
  }

  createMyntraLinkedOrder(orderGroup) {
    const sortedOrders = this.sortOrdersByLifecycleStage(orderGroup);
    const orderTimeline = this.buildOrderTimeline(sortedOrders);
    const masterOrder = this.mergeMyntraOrderData(sortedOrders);

    masterOrder.lifecycleProtection = {
      emailsLinked: orderGroup.length,
      timeline: orderTimeline,
      integrityChecks: this.performIntegrityChecks(sortedOrders),
      linkedAt: new Date().toISOString(),
      linkingStrategy: "myntra_enhanced",
    };

    return masterOrder;
  }

  mergeMyntraOrderData(sortedOrders) {
    const baseOrder = sortedOrders.reduce((best, current) => {
      return (current.confidence || 0) > (best.confidence || 0)
        ? current
        : best;
    }, sortedOrders[0]);

    const masterOrder = { ...baseOrder };

    for (const order of sortedOrders) {
      if (!masterOrder.orderId && order.orderId) {
        masterOrder.orderId = order.orderId;
      }

      if (!masterOrder.trackingId && order.trackingId) {
        masterOrder.trackingId = order.trackingId;
      }

      if (this.shouldUpdateStatus(masterOrder.status, order.status)) {
        masterOrder.status = order.status;
      }

      if (!masterOrder.amount && order.amount) {
        masterOrder.amount = order.amount;
      }

      if (order.products && order.products.length > 0 && masterOrder.products) {
        masterOrder.products = this.mergeProductData(
          masterOrder.products,
          order.products
        );
      }

      if (!masterOrder.deliveryAddress && order.deliveryAddress) {
        masterOrder.deliveryAddress = order.deliveryAddress;
      }
    }

    masterOrder.isLinkedOrder = sortedOrders.length > 1;
    masterOrder.linkedEmailCount = sortedOrders.length;
    masterOrder.linkedEmails = sortedOrders.map((order) => ({
      emailIndex: order.emailIndex,
      emailType: order.emailType,
      status: order.status,
      orderId: order.orderId,
      trackingId: order.trackingId,
      subject: order.originalEmail.headers.subject,
      timestamp: order.emailTimestamp,
    }));

    masterOrder.confidence = Math.min(
      (masterOrder.confidence || 0.7) + sortedOrders.length * 0.1,
      1.0
    );

    return masterOrder;
  }

  // 🔧 UTILITY METHODS

  sortOrdersByLifecycleStage(orderGroup) {
    return orderGroup.sort((a, b) => {
      const stageA = this.getLifecycleStage(a);
      const stageB = this.getLifecycleStage(b);

      if (stageA !== stageB) {
        return stageA - stageB;
      }

      const timestampA = a.emailTimestamp || 0;
      const timestampB = b.emailTimestamp || 0;

      return timestampA - timestampB;
    });
  }

  getLifecycleStage(order) {
    const emailType = order.emailType || "unknown";
    const status = order.status || "unknown";
    const subject = order.originalEmail?.headers?.subject?.toLowerCase() || "";

    if (
      emailType === "order_confirmation" ||
      status === "confirmed" ||
      subject.includes("confirmation") ||
      subject.includes("placed") ||
      subject.includes("thank you")
    ) {
      return 10;
    }

    if (
      status === "processing" ||
      subject.includes("preparing") ||
      subject.includes("processing")
    ) {
      return 20;
    }

    if (
      emailType === "shipping_notification" ||
      status === "shipped" ||
      subject.includes("shipped") ||
      subject.includes("dispatched") ||
      subject.includes("item") ||
      subject.includes("from your order")
    ) {
      return 30;
    }

    if (
      emailType === "delivery_notification" ||
      status === "out_for_delivery" ||
      subject.includes("out for delivery") ||
      subject.includes("arriving") ||
      subject.includes("today")
    ) {
      return 40;
    }

    if (
      emailType === "delivery_confirmation" ||
      status === "delivered" ||
      subject.includes("delivered") ||
      subject.includes("successfully delivered")
    ) {
      return 50;
    }

    if (
      subject.includes("review") ||
      subject.includes("feedback") ||
      subject.includes("rate")
    ) {
      return 60;
    }

    if (
      status === "cancelled" ||
      status === "returned" ||
      subject.includes("cancelled") ||
      subject.includes("returned") ||
      subject.includes("refund")
    ) {
      return 70;
    }

    return 100;
  }

  buildOrderTimeline(sortedOrders) {
    return sortedOrders.map((order) => ({
      emailType: order.emailType || "unknown",
      status: order.status || "unknown",
      stage: this.getLifecycleStage(order),
      date: this.formatEmailDate(order.originalEmail),
      orderId: order.orderId || null,
      trackingId: order.trackingId || null,
      amount: order.amount || null,
      subject: order.originalEmail?.headers?.subject,
    }));
  }

  performIntegrityChecks(sortedOrders) {
    const checks = {
      statusProgression: this.checkStatusProgression(sortedOrders),
      amountConsistency: this.checkAmountConsistency(sortedOrders),
      productConsistency: this.checkProductConsistency(sortedOrders),
      dateProgression: this.checkDateProgression(sortedOrders),
      overall: "unknown",
    };

    const passedChecks = Object.values(checks).filter(
      (check) => check === "pass"
    ).length;
    const totalChecks = Object.keys(checks).length - 1;

    if (passedChecks === totalChecks) {
      checks.overall = "excellent";
    } else if (passedChecks >= totalChecks * 0.75) {
      checks.overall = "good";
    } else if (passedChecks >= totalChecks * 0.5) {
      checks.overall = "acceptable";
    } else {
      checks.overall = "poor";
    }

    return checks;
  }

  checkStatusProgression(sortedOrders) {
    const statusHierarchy = {
      ordered: 1,
      confirmed: 2,
      processing: 3,
      shipped: 4,
      out_for_delivery: 5,
      delivered: 6,
    };

    let lastLevel = 0;
    let hasRegression = false;

    for (const order of sortedOrders) {
      const currentLevel = statusHierarchy[order.status] || 0;
      if (currentLevel < lastLevel) {
        hasRegression = true;
      }
      lastLevel = Math.max(lastLevel, currentLevel);
    }

    return hasRegression ? "warning" : "pass";
  }

  checkAmountConsistency(sortedOrders) {
    const amounts = sortedOrders
      .map((order) => order.amount)
      .filter((amount) => amount && amount > 0);

    if (amounts.length === 0) return "na";

    const uniqueAmounts = [...new Set(amounts)];

    if (uniqueAmounts.length === 1) {
      return "pass";
    } else if (
      uniqueAmounts.every((amount) => Math.abs(amount - amounts[0]) <= 1)
    ) {
      return "pass";
    } else {
      return "warning";
    }
  }

  checkProductConsistency(sortedOrders) {
    const productNames = sortedOrders
      .map((order) => order.products?.[0]?.name)
      .filter(
        (name) =>
          name &&
          name !== "Data not available in email" &&
          !this.isGarbageProductName(name)
      );

    if (productNames.length === 0) return "na";

    const firstProduct = productNames[0].toLowerCase().replace(/[^\w\s]/g, "");
    const allSimilar = productNames.every((product) => {
      const normalized = product.toLowerCase().replace(/[^\w\s]/g, "");
      return this.calculateStringSimilarity(firstProduct, normalized) > 0.7;
    });

    return allSimilar ? "pass" : "warning";
  }

  checkDateProgression(sortedOrders) {
    let lastTimestamp = 0;
    let hasRegression = false;

    for (const order of sortedOrders) {
      const currentTimestamp = order.emailTimestamp || 0;
      if (currentTimestamp < lastTimestamp) {
        hasRegression = true;
      }
      lastTimestamp = currentTimestamp;
    }

    return hasRegression ? "warning" : "pass";
  }

  mergeProductData(existingProducts, newProducts) {
    if (!existingProducts || existingProducts.length === 0) return newProducts;
    if (!newProducts || newProducts.length === 0) return existingProducts;

    const mergedProducts = [...existingProducts];

    for (const newProduct of newProducts) {
      const existingIndex = mergedProducts.findIndex(
        (existing) =>
          this.calculateStringSimilarity(
            existing.name?.toLowerCase() || "",
            newProduct.name?.toLowerCase() || ""
          ) > 0.8
      );

      if (existingIndex >= 0) {
        const existing = mergedProducts[existingIndex];
        mergedProducts[existingIndex] = {
          ...existing,
          description: existing.description || newProduct.description,
          brand: existing.brand || newProduct.brand,
          category: existing.category || newProduct.category,
          image_url: existing.image_url || newProduct.image_url,
          product_url: existing.product_url || newProduct.product_url,
          unit_price: existing.unit_price || newProduct.unit_price,
          total_price: existing.total_price || newProduct.total_price,
        };
      } else {
        mergedProducts.push(newProduct);
      }
    }

    return mergedProducts;
  }

  calculateStringSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;

    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  shouldUpdateStatus(currentStatus, newStatus) {
    const statusHierarchy = {
      ordered: 1,
      confirmed: 2,
      processing: 3,
      shipped: 4,
      out_for_delivery: 5,
      delivered: 6,
      cancelled: 0,
      returned: 0,
    };

    const currentLevel = statusHierarchy[currentStatus] || 1;
    const newLevel = statusHierarchy[newStatus] || 1;

    return newLevel > currentLevel || newLevel === 0;
  }

  // 🔧 EMAIL PARSING AND VALIDATION

  parseEmailWithValidation(email) {
    try {
      const parsedData = parserFactory.parseEmail({
        from: email.headers.from,
        subject: email.headers.subject,
        html: email.body.html,
        text: email.body.text,
        date: email.headers.date,
        messageId: email.messageId,
      });

      if (!parsedData) return null;

      const validatedData = this.validateParsedData(parsedData);
      return this.cleanParsedData(validatedData);
    } catch (error) {
      return null;
    }
  }

  validateParsedData(parsedData) {
    if (!parsedData.orderId && !parsedData.trackingId) {
      throw new Error(`No valid order ID or tracking ID found`);
    }

    if (!parsedData.platform) {
      throw new Error("Missing platform information");
    }

    if (parsedData.products && Array.isArray(parsedData.products)) {
      parsedData.products = parsedData.products.filter((product) =>
        this.isValidProduct(product)
      );
    }

    return parsedData;
  }

  cleanParsedData(parsedData) {
    return {
      platform: parsedData.platform,
      orderId: parsedData.orderId || null,
      trackingId: parsedData.trackingId || null,
      amount: parsedData.amount || null,
      formattedAmount: parsedData.amount
        ? `₹${parsedData.amount}`
        : "Data not available in email",
      products: this.cleanProductsData(parsedData.products || []),
      orderDate: parsedData.orderDate || new Date(),
      status: this.standardizeOrderStatus(parsedData.status),
      emailType: parsedData.emailType || "unknown",
      confidence: parsedData.confidence || 0.7,
      extractedAt: new Date().toISOString(),
      deliveryAddress: parsedData.deliveryAddress || null,
      dataAvailability: this.assessDataAvailability(parsedData),
    };
  }

  cleanProductsData(products) {
    if (!Array.isArray(products) || products.length === 0) {
      return [
        {
          name: "Data not available in email",
          quantity: "Data not available in email",
          price: "Data not available in email",
          formattedPrice: "Data not available in email",
        },
      ];
    }

    const validProducts = products.filter(
      (product) =>
        this.isValidProduct(product) && !this.isGarbageProductName(product.name)
    );

    if (validProducts.length === 0) {
      return [
        {
          name: "Data not available in email",
          quantity: "Data not available in email",
          price: "Data not available in email",
          formattedPrice: "Data not available in email",
        },
      ];
    }

    return validProducts.map((product) => ({
      name: product.name || "Unknown Product",
      quantity: product.quantity || 1,
      price: product.price || product.unit_price || 0,
      formattedPrice: product.price
        ? `₹${product.price}`
        : "Data not available in email",
      type: product.type || "item",
      description: product.description || null,
      image_url: product.image_url || null,
      product_url: product.product_url || null,
      sku: product.sku || null,
      brand: product.brand || null,
      category: product.category || null,
      attributes: product.attributes || null,
    }));
  }

  isGarbageProductName(name) {
    if (!name || typeof name !== "string") return true;

    const nameLower = name.toLowerCase().trim();
    if (nameLower.length < 5) return true;

    const garbagePatterns = [
      /background-image/i,
      /url\(https?/i,
      /media-amazon\.com/i,
      /\.css/i,
      /\.js/i,
      /font-family/i,
      /<!DOCTYPE/i,
      /<html/i,
      /align\s*=\s*/i,
      /center/i,
      /feedback/i,
      /src\s*=/i,
      /style\s*=/i,
      /class\s*=/i,
      /^[\d\s.,;:-]+$/,
      /^[a-f0-9]{10,}$/i,
      /supercoin|saved using|early access|flipkart plus|coin.*used/i,
      /reward|loyalty|member|benefit|cashback|points/i,
      /^(order|item|shipment|delivery|payment|total|amount)$/i,
      /continue shopping|shop now|download app/i,
      /terms.*conditions|privacy.*policy|unsubscribe/i,
    ];

    return garbagePatterns.some((pattern) => pattern.test(nameLower));
  }

  isValidProduct(product) {
    if (!product || !product.name) return false;
    const name = product.name.toString().trim();
    if (name.length < 5) return false;
    return !this.isGarbageProductName(name);
  }

  standardizeOrderStatus(status) {
    if (!status) return "ordered";

    const statusLower = status.toLowerCase();

    if (statusLower.includes("delivered")) return "delivered";
    if (statusLower.includes("shipped") || statusLower.includes("dispatched"))
      return "shipped";
    if (statusLower.includes("confirmed") || statusLower.includes("placed"))
      return "confirmed";
    if (statusLower.includes("cancelled")) return "cancelled";
    if (statusLower.includes("returned")) return "returned";
    if (statusLower.includes("out for delivery")) return "out_for_delivery";
    if (statusLower.includes("processing")) return "processing";

    return "ordered";
  }

  formatEmailDate(email) {
    if (!email || !email.internalDate) return "No date";

    const date = new Date(parseInt(email.internalDate));
    return (
      date.toLocaleDateString("en-IN") +
      " " +
      date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    );
  }

  calculateDataCompleteness(parsedData) {
    const fields = ["orderId", "trackingId", "amount", "products", "orderDate"];
    const availableFields = fields.filter((field) => {
      if (field === "products")
        return parsedData.products && parsedData.products.length > 0;
      return !!parsedData[field];
    });

    return Math.round((availableFields.length / fields.length) * 100);
  }

  assessDataAvailability(parsedData) {
    return {
      hasOrderId: !!parsedData.orderId,
      hasTrackingId: !!parsedData.trackingId,
      hasAmount: !!parsedData.amount,
      hasProducts: !!(parsedData.products && parsedData.products.length > 0),
      hasOrderDate: !!parsedData.orderDate,
      dataCompleteness: this.calculateDataCompleteness(parsedData),
    };
  }

  // 📧 SYNC MANAGEMENT METHODS

  async handleNoEmailsFound(syncRecord, daysToFetch, maxResults) {
    await syncRecord.update({
      status: "completed",
      completed_at: new Date(),
      emails_processed: 0,
      orders_found: 0,
      orders_created: 0,
      metadata: {
        ...syncRecord.metadata,
        summary: {
          message: `No emails found in last ${daysToFetch} days`,
          searchConfiguration: { daysToFetch, maxResults },
        },
      },
    });

    return {
      success: true,
      syncId: syncRecord.id,
      ordersSaved: 0,
      ordersUpdated: 0,
      emailsProcessed: 0,
      message: `No order emails found in the last ${daysToFetch} days`,
      configuration: { daysToFetch, maxResults },
    };
  }

  async completeSyncWithResults(
    syncRecord,
    processResult,
    daysToFetch,
    maxResults
  ) {
    const syncSummary = {
      totalEmails: processResult.emailsProcessed,
      emailsProcessed: processResult.emailsProcessed,
      ordersCreated: processResult.ordersCreated,
      ordersUpdated: processResult.ordersUpdated,
      ordersSkipped: processResult.ordersSkipped,
      parsingErrors: processResult.parsingErrors,
      totalLinksFound: processResult.totalLinksFound,
      deliveryUpdatesApplied: processResult.deliveryUpdatesApplied || 0,
      platforms: Object.keys(processResult.platformStats || {}),
      platformStats: processResult.platformStats,
      processingStrategy: "delivery_priority_with_enhanced_parsing",
      dataQuality: this.assessOverallDataQuality(processResult.processedOrders),
      success: processResult.ordersCreated + processResult.ordersUpdated > 0,
    };

    await syncRecord.update({
      status: "completed",
      completed_at: new Date(),
      emails_processed: processResult.emailsProcessed,
      orders_found: processResult.ordersCreated + processResult.ordersUpdated,
      orders_created: processResult.ordersCreated,
      metadata: {
        ...syncRecord.metadata,
        summary: syncSummary,
        detailedResults: {
          skippedEmails: processResult.skippedEmails,
          errorEmails: processResult.errorEmails,
        },
      },
    });

    logger.info(
      `Enhanced sync completed: ${processResult.ordersCreated} created, ${processResult.ordersUpdated} updated, ${processResult.deliveryUpdatesApplied} delivery updates`
    );

    return {
      success: true,
      syncId: syncRecord.id,
      ordersSaved: processResult.ordersCreated,
      ordersUpdated: processResult.ordersUpdated,
      emailsProcessed: processResult.emailsProcessed,
      deliveryUpdatesApplied: processResult.deliveryUpdatesApplied,
      totalLinksFound: processResult.totalLinksFound,
      summary: syncSummary,
      configuration: { daysToFetch, maxResults },
      orders: processResult.processedOrders.map((order) =>
        this.formatOrderForFrontend(order)
      ),
    };
  }

  formatOrderForFrontend(order) {
    return {
      id: order.id,
      platform: order.platform,
      orderId: order.platform_order_id,
      productName: order.product_name,
      amount: order.total_amount,
      formattedAmount: order.total_amount
        ? `₹${order.total_amount}`
        : "Data not available in email",
      status: order.status,
      orderDate: order.order_date,
      trackingNumber: order.tracking_number || "Data not available in email",
      deliveredDate: order.delivered_date,
      confidence: order.confidence_score,
      isLinkedOrder: order.parsed_data?.isLinkedOrder || false,
      linkedEmailCount: order.parsed_data?.linkedEmailCount || 1,
      dataCompleteness: this.calculateDataCompletenessFromOrder(order),
      lastUpdated: order.last_updated,
    };
  }

  calculateDataCompletenessFromOrder(order) {
    const fields = [
      "platform_order_id",
      "total_amount",
      "product_name",
      "tracking_number",
      "order_date",
    ];
    const availableFields = fields.filter((field) => {
      const value = order[field];
      return value && value !== 0 && value !== "Data not available in email";
    });

    return Math.round((availableFields.length / fields.length) * 100);
  }

  assessOverallDataQuality(processedOrders) {
    if (processedOrders.length === 0)
      return { completeness: 0, quality: "no_data" };

    const avgCompleteness =
      processedOrders.reduce(
        (sum, order) => sum + this.calculateDataCompletenessFromOrder(order),
        0
      ) / processedOrders.length;

    return {
      completeness: Math.round(avgCompleteness),
      quality:
        avgCompleteness >= 80
          ? "high"
          : avgCompleteness >= 60
          ? "medium"
          : "low",
      ordersWithFullData: processedOrders.filter(
        (order) => this.calculateDataCompletenessFromOrder(order) >= 80
      ).length,
    };
  }

  // 📊 SYNC STATUS AND HISTORY METHODS

  async getSyncStatus(userId, syncId) {
    const syncRecord = await EmailSync.findOne({
      where: { id: syncId, user_id: userId },
    });

    if (!syncRecord) {
      throw new Error("Sync record not found");
    }

    return {
      syncId: syncRecord.id,
      status: syncRecord.status,
      startedAt: syncRecord.started_at,
      completedAt: syncRecord.completed_at,
      emailsProcessed: syncRecord.emails_processed,
      ordersFound: syncRecord.orders_found,
      ordersCreated: syncRecord.orders_created,
      metadata: syncRecord.metadata,
      errors: syncRecord.errors,
      searchConfiguration: syncRecord.metadata?.resolvedParameters,
    };
  }

  async getSyncHistory(userId, limit = 10) {
    const syncRecords = await EmailSync.findAll({
      where: { user_id: userId },
      order: [["created_at", "DESC"]],
      limit: parseInt(limit),
    });

    return syncRecords.map((record) => ({
      syncId: record.id,
      status: record.status,
      startedAt: record.started_at,
      completedAt: record.completed_at,
      emailsProcessed: record.emails_processed || 0,
      ordersFound: record.orders_found || 0,
      ordersCreated: record.orders_created || 0,
      summary: record.metadata?.summary || {},
      processingStrategy: record.metadata?.strategy || "unknown",
    }));
  }

  async getSyncStats(userId) {
    const [totalSyncs, completedSyncs, totalOrders] = await Promise.all([
      EmailSync.count({ where: { user_id: userId } }),
      EmailSync.count({ where: { user_id: userId, status: "completed" } }),
      Order.count({ where: { user_id: userId } }),
    ]);

    const lastSync = await EmailSync.findOne({
      where: { user_id: userId },
      order: [["created_at", "DESC"]],
      attributes: ["created_at", "status", "orders_created", "metadata"],
    });

    return {
      totalSyncs,
      completedSyncs,
      failedSyncs: totalSyncs - completedSyncs,
      totalOrders,
      lastSyncAt: lastSync?.created_at,
      lastSyncStatus: lastSync?.status,
      lastSyncOrdersCreated: lastSync?.orders_created || 0,
      lastSyncConfiguration: lastSync?.metadata?.resolvedParameters,
      processingStrategy: lastSync?.metadata?.strategy || "unknown",
    };
  }
}

module.exports = new SyncService();
