import Coupon from "../models/coupon.model.js";
import Order from "../models/order.model.js";
import { sendOrderConfirmationEmail } from "../lib/email.js";
import {
  generateTrackingNumber,
  getTrackingSnapshot,
} from "../lib/order-tracking.js";
import { stripe } from "../lib/stripe.js";
import { buildClientUrl } from "../lib/runtime-config.js";

const getPrimaryImage = (product) =>
  product?.image || product?.images?.[0] || "";

const ORDER_EMAIL_FIELDS = "name email";

async function getHydratedOrder(orderId) {
  return Order.findById(orderId)
    .populate("products.product", "name images category")
    .populate("user", ORDER_EMAIL_FIELDS);
}

function getTrackingResponse(order, trackingSnapshot) {
  return {
    orderId: order._id,
    trackingNumber: order.trackingNumber,
    orderStatus: trackingSnapshot.currentStatus,
    orderStatusLabel: trackingSnapshot.currentLabel,
    estimatedDeliveryDate: trackingSnapshot.estimatedDeliveryDate,
  };
}

async function processPaidCheckoutSession(session) {
  const existingOrder = await Order.findOne({ stripeSessionId: session.id });

  if (existingOrder) {
    let order = await getHydratedOrder(existingOrder._id);
    let trackingSnapshot = getTrackingSnapshot(order);

    try {
      const emailResult = await ensureOrderConfirmationEmail(existingOrder);
      order = emailResult.order || order;
      trackingSnapshot = emailResult.trackingSnapshot || trackingSnapshot;
    } catch (emailError) {
      console.error("Error sending order confirmation email:", emailError);
    }

    return { order, trackingSnapshot, isExistingOrder: true };
  }

  if (session.metadata.couponCode) {
    await Coupon.findOneAndUpdate(
      {
        code: session.metadata.couponCode,
        userId: session.metadata.userId,
      },
      {
        isActive: false,
      }
    );
  }

  const products = JSON.parse(session.metadata.products);
  const newOrder = new Order({
    user: session.metadata.userId,
    products: products.map((product) => ({
      product: product.id,
      quantity: product.quantity,
      price: product.price,
    })),
    totalAmount: session.amount_total / 100,
    status: "confirmed",
    trackingNumber: generateTrackingNumber(),
    estimatedDeliveryDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    stripeSessionId: session.id,
  });

  let orderRecord = newOrder;

  try {
    await newOrder.save();
  } catch (error) {
    if (error?.code === 11000) {
      const duplicateOrder = await Order.findOne({ stripeSessionId: session.id });

      if (!duplicateOrder) {
        throw error;
      }

      orderRecord = duplicateOrder;
    } else {
      throw error;
    }
  }

  let order = await getHydratedOrder(orderRecord._id);
  let trackingSnapshot = getTrackingSnapshot(order);

  try {
    const emailResult = await ensureOrderConfirmationEmail(orderRecord);
    order = emailResult.order || order;
    trackingSnapshot = emailResult.trackingSnapshot || trackingSnapshot;
  } catch (emailError) {
    console.error("Error sending order confirmation email:", emailError);
  }

  return { order, trackingSnapshot, isExistingOrder: false };
}

async function ensureOrderConfirmationEmail(orderDoc) {
  const order = await getHydratedOrder(orderDoc._id);

  if (!order) {
    return { order: null, trackingSnapshot: null, emailSent: false };
  }

  const trackingSnapshot = getTrackingSnapshot(order);

  if (order.confirmationEmail?.sentAt) {
    return {
      order,
      trackingSnapshot,
      emailSent: true,
      alreadySent: true,
    };
  }

  const customer = order.user;
  const attemptedAt = new Date();

  if (!customer?.email) {
    await Order.findByIdAndUpdate(order._id, {
      $set: {
        "confirmationEmail.lastAttemptAt": attemptedAt,
        "confirmationEmail.error": "Customer email missing",
      },
    });

    return {
      order,
      trackingSnapshot,
      emailSent: false,
      skipped: true,
    };
  }

  try {
    await sendOrderConfirmationEmail({
      order,
      customer,
      trackingUrl: buildClientUrl(`/orders/${order._id}/tracking`),
      trackingSnapshot,
    });

    await Order.findByIdAndUpdate(order._id, {
      $set: {
        "confirmationEmail.sentAt": attemptedAt,
        "confirmationEmail.lastAttemptAt": attemptedAt,
        "confirmationEmail.recipient": customer.email,
        "confirmationEmail.error": null,
      },
    });

    order.confirmationEmail = {
      sentAt: attemptedAt,
      lastAttemptAt: attemptedAt,
      recipient: customer.email,
      error: null,
    };

    return {
      order,
      trackingSnapshot,
      emailSent: true,
    };
  } catch (error) {
    await Order.findByIdAndUpdate(order._id, {
      $set: {
        "confirmationEmail.lastAttemptAt": attemptedAt,
        "confirmationEmail.recipient": customer.email,
        "confirmationEmail.error": error.message,
      },
    });

    throw error;
  }
}

export const createCheckoutSession = async (req, res) => {
  try {
    const { products, couponCode } = req.body;

    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: "Invalid or empty products array" });
    }

    let totalAmount = 0;

    const lineItems = products.map((product) => {
      const amount = Math.round(product.price * 100); 
      totalAmount += amount * product.quantity;

      return {
        price_data: {
          currency: "inr",
          product_data: {
            name: product.name,
            images: [getPrimaryImage(product)].filter(Boolean),
          },
          unit_amount: amount,
        },
        quantity: product.quantity || 1,
      };
    });

    let coupon = null;
    if (couponCode) {
      coupon = await Coupon.findOne({
        code: couponCode,
        userId: req.user._id,
        isActive: true,
      });

      if (coupon) {
        totalAmount -= Math.round(
          (totalAmount * coupon.discountPercentage) / 100
        );
      }
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: lineItems,
      mode: "payment",
      success_url: buildClientUrl(
        "/purchase-success?session_id={CHECKOUT_SESSION_ID}"
      ),
      cancel_url: buildClientUrl("/purchase-cancel"),
      discounts: coupon
        ? [
            {
              coupon: await createStripeCoupon(coupon.discountPercentage),
            },
          ]
        : [],
      metadata: {
        userId: req.user._id.toString(),
        couponCode: couponCode || "",
        products: JSON.stringify(
          products.map((p) => ({
            id: p._id,
            quantity: p.quantity,
            price: p.price,
          }))
        ),
      },
    });

    if (totalAmount >= 20000) {
      await createNewCoupon(req.user._id);
    }

    res.status(200).json({ id: session.id, totalAmount: totalAmount / 100 });
  } catch (error) {
    console.error("Error processing checkout:", error);
    res
      .status(500)
      .json({ message: "Error processing checkout", error: error.message });
  }
};

export const checkoutSuccess = async (req, res) => {
  try {
    const { sessionId } = req.body;
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === "paid") {
      const { order, trackingSnapshot, isExistingOrder } =
        await processPaidCheckoutSession(session);

      res.status(200).json({
        success: true,
        message: isExistingOrder
          ? "Payment already processed for this session."
          : "Payment successful, order created, and coupon deactivated if used.",
        ...getTrackingResponse(order, trackingSnapshot),
      });
      return;
    }

    return res.status(400).json({
      success: false,
      message: "Payment has not been completed for this checkout session.",
    });
  } catch (error) {
    console.error("Error processing successful checkout:", error);
    res.status(500).json({
      message: "Error processing successful checkout",
      error: error.message,
    });
  }
};

export const stripeWebhook = async (req, res) => {
  const signature = req.headers["stripe-signature"];

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(200).json({
      received: false,
      message: "STRIPE_WEBHOOK_SECRET is not configured.",
    });
  }

  if (!signature) {
    return res.status(400).send("Missing Stripe signature");
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    console.error("Stripe webhook signature verification failed:", error);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  try {
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const session = event.data.object;

      if (session.payment_status === "paid") {
        await processPaidCheckoutSession(session);
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Error handling Stripe webhook:", error);
    return res.status(500).json({
      received: false,
      message: "Error handling Stripe webhook",
      error: error.message,
    });
  }
};

export const getOrderTracking = async (req, res) => {
  try {
    const { orderId } = req.params;
    const query =
      req.user.role === "admin"
        ? { _id: orderId }
        : { _id: orderId, user: req.user._id };

    const order = await Order.findOne(query)
      .populate("products.product", "name images category")
      .populate("user", "name email");

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const trackingSnapshot = getTrackingSnapshot(order);

    return res.status(200).json({
      orderId: order._id,
      trackingNumber: order.trackingNumber,
      totalAmount: order.totalAmount,
      createdAt: order.createdAt,
      estimatedDeliveryDate: trackingSnapshot.estimatedDeliveryDate,
      currentStatus: trackingSnapshot.currentStatus,
      currentStatusLabel: trackingSnapshot.currentLabel,
      phases: trackingSnapshot.phases,
      products: order.products,
    });
  } catch (error) {
    console.error("Error fetching order tracking:", error);
    return res.status(500).json({
      message: "Error fetching order tracking",
      error: error.message,
    });
  }
};

async function createStripeCoupon(discountPercentage) {
  const coupon = await stripe.coupons.create({
    percent_off: discountPercentage,
    duration: "once",
  });

  return coupon.id;
}

async function createNewCoupon(userId) {
  await Coupon.findOneAndDelete({ userId });

  const newCoupon = new Coupon({
    code: "GIFT" + Math.random().toString(36).substring(2, 8).toUpperCase(),
    discountPercentage: 10,
    expirationDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), 
    userId: userId,
  });

  await newCoupon.save();

  return newCoupon;
}
