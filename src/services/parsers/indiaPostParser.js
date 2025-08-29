const baseParser = require("./baseParser");

module.exports = {
  parse: (html) => {
    const trackingId = baseParser.extractTrackingId(html, /[A-Z]{2}\d{9}IN/); // India Post format e.g. EM123456789IN

    return {
      source: "IndiaPost",
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
