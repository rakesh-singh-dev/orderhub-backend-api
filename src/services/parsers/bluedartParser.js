const baseParser = require("./baseParser");

module.exports = {
  parse: (html) => {
    const trackingId = baseParser.extractTrackingId(html, /\d{11}/); // BlueDart 11-digit

    return {
      source: "BlueDart",
      orderId: trackingId || "Details not available",
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
