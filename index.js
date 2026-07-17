import express from "express";
import pool from "./config/db.js";
import cors from "cors";
import cron from "node-cron";
import { releaseSellerBalances } from "./jobs/releaseSellerBalance.js";

const app = express();

import productRoutes from "./routes/productRoutes.js";
import blogRoutes from "./routes/blogRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";


// Middleware
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// Database connection
pool
  .connect()
  .then((client) => {
    console.log("Connected to the database");
    client.release();
  })
  .catch((err) => {
    console.error("Error connecting to the database", err);
  });


// Routes
app.use("/products", productRoutes);
app.use("/blogs", blogRoutes);
app.use("/auth", authRoutes);
app.use("/payments", paymentRoutes);
app.use("/category", categoryRoutes);
app.use("/dashboard", dashboardRoutes);


// ======================================
// RELEASE SELLER PENDING BALANCES
// Runs every day at 1:00 AM
// ======================================

cron.schedule("0 1 * * *", async () => {

  console.log(
    "Running seller balance release job..."
  );

  try {

    await releaseSellerBalances();

    console.log(
      "Seller balances released successfully"
    );

  } catch(error){

    console.error(
      "Seller balance release failed:",
      error.message
    );

  }

});


// Server
app.listen(4000, () => {
  console.log("Server is running on port 4000");
});