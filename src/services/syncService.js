// src/services/syncService.js
const GmailService = require("./gmailService");
const emailParserFactory = require("./emailParserFactory");
const { User, Order, OrderItem, EmailSync } = require("../models");
const logger = require("../utils/logger");
const emailConfig = require("../config/emailConfig");
const { ensureFreshGoogleToken } = require("../utils/googleToken");

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

      syncRecord = await EmailSync.create({
        user_id: userId,
        status: "in_progress",
        started_at: new Date(),
        metadata: { options },
      });

      const syncId = syncRecord.id;
      logger.info(
        `Starting sync for user ${user.email} with sync ID: ${syncId}`
      );

      await this.gmailService.initializeClient(
        user.access_token,
        user.refresh_token
      );

      // Fetch basic email list
      const daysToFetch = options.daysToFetch || emailConfig.defaultDaysToFetch;
      const maxResults = options.maxResults || emailConfig.maxEmailsPerSync;
      const emails = await this.gmailService.getEmailsFromDateRange(
        daysToFetch,
        maxResults
      );
      logger.info(
        `Found ${emails.length} emails from last ${daysToFetch} days`
      );

      // Fetch details for each email
      const emailDetails = await this.gmailService.getEmailDetails(emails);
      logger.info(`Fetched details for ${emailDetails.length} emails`);

      // UPDATED: Parse each email with improved duplicate handling
      const parsedOrders = [];
      let ordersCreated = 0;
      let ordersUpdated = 0;
      let ordersSkipped = 0;

      for (const email of emailDetails) {
        const parsed = emailParserFactory.parseAndHash({
          from: email.headers.from,
          subject: email.headers.subject,
          html: email.body.html,
          text: email.body.text,
          userId,
        });

        if (!parsed || !parsed.orderId) {
          ordersSkipped++;
          continue;
        }

        // FIXED: Check for existing order by hash
        const existingOrder = await Order.findOne({
          where: { user_id: userId, hash: parsed.hash },
        });

        if (existingOrder) {
          console.log(
            `🔍 Found existing order: ${parsed.platform}-${parsed.orderId}`
          );
          console.log(`📊 Existing amount: ₹${existingOrder.total_amount}`);
          console.log(`📊 New amount: ₹${parsed.totalAmount}`);

          // Check if this order has better/different data
          const shouldUpdate =
            // Update if new amount is different and valid
            (parsed.totalAmount &&
              parsed.totalAmount !== parseFloat(existingOrder.total_amount)) ||
            // Update if status changed
            (parsed.status && parsed.status !== existingOrder.status) ||
            // Update if product name is better (longer/more complete)
            (parsed.items?.[0]?.name &&
              parsed.items[0].name.length >
                (existingOrder.product_name || "").length);

          if (shouldUpdate) {
            console.log(`🔄 Updating order with new data...`);

            const updateData = {};
            if (parsed.totalAmount)
              updateData.total_amount = parsed.totalAmount;
            if (parsed.status) updateData.status = parsed.status;
            if (parsed.items?.[0]?.name)
              updateData.product_name = parsed.items[0].name;
            if (parsed.orderDate) updateData.order_date = parsed.orderDate;
            if (parsed.trackingId) updateData.tracking_id = parsed.trackingId;
            if (parsed.deliveryDate)
              updateData.expected_delivery = parsed.deliveryDate;

            updateData.last_updated = new Date();
            updateData.sync_id = syncId;
            updateData.parsed_data = parsed;

            console.log(`📝 Update data:`, updateData);

            await existingOrder.update(updateData);

            // Also update items if we have new ones
            if (parsed.items && parsed.items.length > 0) {
              await OrderItem.destroy({
                where: { order_id: existingOrder.id },
              });

              for (const item of parsed.items) {
                await OrderItem.create({
                  order_id: existingOrder.id,
                  name: item.name,
                  quantity: item.quantity || 1,
                  unit_price: item.price || 0,
                  total_price: (item.price || 0) * (item.quantity || 1),
                });
              }
            }

            ordersUpdated++;
            console.log(
              `✅ Order updated: ${parsed.platform}-${
                parsed.orderId
              } | New amount: ₹${parsed.totalAmount || "N/A"}`
            );
          } else {
            console.log(
              `⏭️ No updates needed for: ${parsed.platform}-${parsed.orderId}`
            );
            ordersSkipped++;
          }

          continue; // Skip to next email
        }

        // If no existing order found, add to creation list
        parsedOrders.push({ ...parsed, _email: email });
      }

      // Save all new orders
      const savedOrders = [];
      for (const parsedOrder of parsedOrders) {
        try {
          console.log("📊 Attempting to save NEW order:", {
            user_id: userId,
            platform: parsedOrder.platform,
            order_id: parsedOrder.orderId,
            platform_order_id: parsedOrder.orderId,
            total_amount: parsedOrder.totalAmount,
            currency: "INR",
            order_date: parsedOrder.orderDate || new Date(),
            status: parsedOrder.status || "ordered",
          });

          const order = await Order.create({
            user_id: userId,
            platform: parsedOrder.platform,
            order_id: parsedOrder.orderId,
            platform_order_id: parsedOrder.orderId,
            product_name: parsedOrder.items?.[0]?.name || "Unknown Product",
            total_amount: parsedOrder.totalAmount || 0,
            currency: "INR",
            order_date: parsedOrder.orderDate || new Date(),
            status: (parsedOrder.status || "ordered").toLowerCase(),
            tracking_id: parsedOrder.trackingId,
            expected_delivery: parsedOrder.deliveryDate,
            email_message_id: parsedOrder._email
              ? parsedOrder._email.messageId
              : null,
            raw_email_data: parsedOrder._email
              ? JSON.stringify(parsedOrder._email)
              : null,
            parsed_data: parsedOrder,
            confidence_score: parsedOrder.confidence
              ? parsedOrder.confidence / 100
              : 0.9,
            sync_id: syncId,
            last_updated: new Date(),
            hash: parsedOrder.hash,
          });

          if (parsedOrder.items && parsedOrder.items.length > 0) {
            console.log(
              `📦 Saving ${parsedOrder.items.length} items for order ${order.id}`
            );

            for (let i = 0; i < parsedOrder.items.length; i++) {
              const item = parsedOrder.items[i];

              // Validate and normalize item data
              const itemData = {
                order_id: order.id,
                name: item.name || "Unknown Item",
                quantity: Math.max(1, parseInt(item.quantity) || 1),
                unit_price: Math.max(0, parseFloat(item.price) || 0),
                total_price: Math.max(
                  0,
                  (parseFloat(item.price) || 0) *
                    Math.max(1, parseInt(item.quantity) || 1)
                ),
              };

              console.log(`  📦 Item ${i + 1}:`, {
                name: itemData.name.substring(0, 40) + "...",
                quantity: itemData.quantity,
                unit_price: itemData.unit_price,
                total_price: itemData.total_price,
              });

              try {
                await OrderItem.create(itemData);
                console.log(`  ✅ Item ${i + 1} saved successfully`);
              } catch (itemError) {
                console.error(`  ❌ Error saving item ${i + 1}:`, {
                  error: itemError.message,
                  itemData: itemData,
                });
              }
            }
          } else {
            console.log("⚠️  No items to save for this order");
          }

          savedOrders.push(order);
          ordersCreated++;
          logger.info(
            `Order created: ${parsedOrder.platform}-${parsedOrder.orderId}`
          );
        } catch (error) {
          logger.error(`Error saving order ${parsedOrder.orderId}:`, error);
          console.error("❌ Database error:", {
            message: error.message,
            constraint: error.constraint,
            detail: error.detail,
          });
        }
      }

      // ENHANCED: Summary logging
      console.log(`\n📊 SYNC SUMMARY:`);
      console.log(`- Orders created: ${ordersCreated}`);
      console.log(`- Orders updated: ${ordersUpdated}`);
      console.log(`- Orders skipped: ${ordersSkipped}`);
      console.log(`- Total emails processed: ${emailDetails.length}`);

      // Update sync record
      await syncRecord.update({
        status: "completed",
        completed_at: new Date(),
        emails_processed: emailDetails.length,
        orders_found: parsedOrders.length + ordersUpdated,
        orders_created: savedOrders.length,
        metadata: {
          ...syncRecord.metadata,
          summary: {
            totalEmails: emails.length,
            orderEmails: parsedOrders.length + ordersUpdated,
            platforms: emailConfig.platforms
              ? emailConfig.platforms.map((p) => p.name)
              : [],
            duplicates: ordersSkipped,
            created: ordersCreated,
            updated: ordersUpdated,
            skipped: ordersSkipped,
          },
        },
      });

      logger.info(
        `Sync completed for user ${user.email}: ${ordersCreated} orders created, ${ordersUpdated} orders updated`
      );

      return {
        success: true,
        syncId,
        ordersSaved: savedOrders.length,
        ordersUpdated: ordersUpdated,
        emailsProcessed: emailDetails.length,
        summary: syncRecord.metadata?.summary,
      };
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
}

module.exports = new SyncService();
