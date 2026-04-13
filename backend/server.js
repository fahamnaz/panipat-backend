import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";

import authRoutes from "./routes/auth.route.js";
import productRoutes from "./routes/product.route.js";
import cartRoutes from "./routes/cart.route.js";
import couponRoutes from "./routes/coupon.route.js";
import paymentRoutes from "./routes/payment.route.js";
import analyticsRoutes from "./routes/analytics.route.js";
import { stripeWebhook } from "./controllers/payment.controller.js";
import cors from "cors";

import { connectDB } from "./lib/db.js";
import { FRONTEND_ORIGINS, isAllowedOrigin } from "./lib/runtime-config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(projectRoot, ".env") });

const app = express();
const PORT = process.env.PORT || 5001;
app.set("trust proxy", 1);

app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook,
);

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }

      return callback(
        new Error(`CORS blocked for origin: ${origin || "unknown"}`),
      );
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: "10mb" })); // allows you to parse the body of the request
app.use(cookieParser());

app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/analytics", analyticsRoutes);

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({ message: "Invalid JSON payload" });
  }

  if (error.message?.startsWith("CORS blocked for origin:")) {
    return res.status(403).json({ message: error.message });
  }

  return next(error);
});

app.listen(PORT, () => {
  console.log("Server is running on http://localhost:" + PORT);
  console.log("Allowed frontend origins:", FRONTEND_ORIGINS.join(", "));
  connectDB();
});
