const baseParser = require("./baseParser");

module.exports = {
  parse: (html) => {
    // Extract details from DTDC mails
    const orderId = baseParser.extractOrderId(html, /(DTDC\d+)/i);
    const trackingId = baseParser.extractTrackingId(html, /(DTDC\d+)/i);

    return {
      source: "DTDC",
      orderId: orderId || "Details not available",
      trackingId: trackingId || "Details not available",
      items: ["Details not available"],
      price: "Details not available",
      bookedAt: baseParser.extractDate(html) || "Details not available",
      expectedDelivery:
        baseParser.extractExpectedDelivery(html) || "Details not available",
      deliveryStatus:
        baseParser.extractDeliveryStatus(html) || "Details not available",
    };
  },
};
