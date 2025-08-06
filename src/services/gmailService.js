// src/services/gmailService.js
const { google } = require("googleapis");
const logger = require("../utils/logger");
const fs = require("fs");
const path = require("path");

function sanitizeFilename(str) {
  return String(str)
    .replace(/[^a-z0-9]/gi, "_")
    .replace(/_+/g, "_")
    .slice(0, 60)
    .toLowerCase();
}

class GmailService {
  constructor() {
    this.gmail = null;
  }

  async initializeClient(accessToken, refreshToken) {
    try {
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      this.gmail = google.gmail({ version: "v1", auth: oauth2Client });
      logger.info("Gmail client initialized successfully");
    } catch (error) {
      logger.error("Error initializing Gmail client:", error);
      throw error;
    }
  }

  async getEmailsFromDateRange(daysToFetch, maxResults) {
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - daysToFetch);
    const dateString = dateFrom.toISOString().split("T")[0].replace(/-/g, "/");

    const query = `(subject:order OR subject:shipped OR subject:delivered) after:${dateString} in:anywhere`;

    logger.info(`Searching emails with query: ${query}`);

    try {
      const response = await this.gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults: maxResults,
      });

      return response.data.messages || [];
    } catch (error) {
      logger.error("Error searching emails:", error);
      return [];
    }
  }

  async getEmailDetails(messageIds) {
    const emailDetails = [];
    const batchSize = 10; // Adjust as needed

    for (let i = 0; i < messageIds.length; i += batchSize) {
      const batch = messageIds.slice(i, i + batchSize);
      const batchPromises = batch.map((messageId) =>
        this.getSingleEmailDetails(messageId)
      );

      try {
        const batchResults = await Promise.allSettled(batchPromises);
        const successfulResults = batchResults
          .filter((result) => result.status === "fulfilled")
          .map((result) => result.value)
          .filter((email) => email !== null);

        emailDetails.push(...successfulResults);
        successfulResults.forEach((email, idx) => {
          if (!email) return;
          const { headers, body } = email;
          const subject = headers.subject || "no_subject";
          const date = headers.date
            ? headers.date.replace(/[\s:,]/g, "_").slice(0, 20)
            : "no_date";
          const safeName = sanitizeFilename(`${date}_${subject}`);
          const dir = path.join(__dirname, "../../debug_emails");
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

          const ext = body && body.html ? ".html" : ".txt";
          const filePath = path.join(
            dir,
            `email_${Date.now()}_${safeName}${ext}`
          );

          const content =
            body && body.html
              ? body.html
              : body && body.text
              ? body.text
              : JSON.stringify(email, null, 2);

          fs.writeFileSync(filePath, content);
        });
      } catch (error) {
        logger.error(`Error fetching batch ${i / batchSize + 1}:`, error);
      }
    }

    return emailDetails;
  }

  async getSingleEmailDetails(messageId) {
    try {
      const response = await this.gmail.users.messages.get({
        userId: "me",
        id: messageId.id || messageId,
        format: "full",
      });

      const message = response.data;
      const headers = message.payload.headers;
      const extractedHeaders = this.extractHeaders(headers);
      const body = this.extractEmailBody(message.payload);

      return {
        id: message.id,
        threadId: message.threadId,
        labelIds: message.labelIds,
        snippet: message.snippet,
        internalDate: message.internalDate,
        sizeEstimate: message.sizeEstimate,
        headers: extractedHeaders, // { from, subject, date, ... }
        body: body, // { text, html }
        messageId: extractedHeaders["message-id"] || null,
      };
    } catch (error) {
      logger.error(`Error fetching email details for ${messageId}:`, error);
      return null;
    }
  }

  extractHeaders(headers) {
    const extracted = {};
    const importantHeaders = ["from", "to", "subject", "date", "message-id"];
    headers.forEach((header) => {
      if (importantHeaders.includes(header.name.toLowerCase())) {
        extracted[header.name.toLowerCase()] = header.value;
      }
    });
    return extracted;
  }

  extractEmailBody(payload) {
    if (!payload) return { text: "", html: "" };

    let text = "";
    let html = "";

    function walkParts(part) {
      if (part.body && part.body.data) {
        const content = Buffer.from(part.body.data, "base64").toString("utf-8");
        if (part.mimeType === "text/plain" && !text) text = content;
        if (part.mimeType === "text/html" && !html) html = content;
      }
      if (part.parts) {
        part.parts.forEach(walkParts);
      }
    }
    walkParts(payload);

    return { text, html };
  }
}

module.exports = GmailService;
