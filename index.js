import express from "express";
import pool from "./config/db.js";
import cors from "cors";
import cron from "node-cron";
import { Resend } from "resend";
import { contactUsEmail } from "./templates/contactUs.js";
import { releaseSellerBalances } from "./jobs/releaseSellerBalance.js";

const app = express();

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

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
// CONTACT US HANDLER
// ======================================

app.post("/contact", async (req, res) => {
  const { name, email, subject, message } = req.body;

  // Basic validation
  if (!name || !email || !subject || !message) {
    return res.status(400).json({
      success: false,
      message: "All fields are required",
    });
  }

  try {
    await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: "ritualandreset@gmail.com",
      replyTo: email,
      subject: `[Contact Form] ${subject}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
          <div style="background-color: #2E7D32; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h2 style="color: white; margin: 0;">New Contact Message</h2>
          </div>

          <div style="padding: 24px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px;">
            <p>You have received a new message from the Contact Us form.</p>

            <div style="background-color: #f9f9f9; padding: 16px; border-radius: 6px; margin: 20px 0;">
              <p><strong>Name:</strong> ${name}</p>
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Subject:</strong> ${subject}</p>
            </div>

            <h3 style="color: #2E7D32;">Message</h3>

            <div style="background-color: #f9f9f9; padding: 16px; border-radius: 6px; border-left: 4px solid #2E7D32;">
              <p style="white-space: pre-line; margin: 0;">${message}</p>
            </div>

            <p style="margin-top: 24px; font-size: 14px; color: #666;">
              You can reply directly to this email to respond to the customer.
            </p>
          </div>
        </div>
      `,
    });

    res.status(200).json({
      success: true,
      message: "Your message has been sent successfully.",
    });
  } catch (error) {
    console.error("Contact form error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to send message. Please try again later.",
    });
  }
});

// ======================================
// RELEASE SELLER PENDING BALANCES
// Runs every day at 1:00 AM
// ======================================

cron.schedule("0 1 * * *", async () => {
  console.log("Running seller balance release job...");

  try {
    await releaseSellerBalances();
    console.log("Seller balances released successfully");
  } catch (error) {
    console.error("Seller balance release failed:", error.message);
  }
});

// Server
app.listen(4000, () => {
  console.log("Server is running on port 4000");
});