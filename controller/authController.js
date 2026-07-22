import pool from "../config/db.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import axios from "axios";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-this";
const JWT_EXPIRY = "7d";

export default {
  register: async (req, res) => {
    const {
      full_name,
      email,
      password,
      phone,
      role,

      // Seller fields
      store_name,
      store_description,
    } = req.body;

    if (!full_name || !email || !password || !role) {
      return res.status(400).json({
        message: "All required fields must be provided.",
      });
    }

    if (!["admin", "customer", "seller"].includes(role)) {
      return res.status(400).json({
        message: "Invalid role.",
      });
    }

    // Seller validation
    if (role === "seller") {
      if (!store_name ) {
        return res.status(400).json({
          message:
            "Store name, bank, bank code and account number are required for sellers.",
        });
      }
    }

    try {
      await pool.query("BEGIN");

      // Check duplicate email
      const existingUser = await pool.query(
        `
      SELECT id
      FROM users
      WHERE LOWER(email)=LOWER($1)
      `,
        [email],
      );

      if (existingUser.rowCount > 0) {
        await pool.query("ROLLBACK");

        return res.status(409).json({
          message: "Email already exists.",
        });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user
      const userResult = await pool.query(
        `
      INSERT INTO users
      (
        full_name,
        email,
        password_hash,
        phone,
        role
      )
      VALUES
      ($1,$2,$3,$4,$5)
      RETURNING id, full_name, email, role, created_at
      `,
        [full_name, email.toLowerCase(), hashedPassword, phone || null, role],
      );

      const user = userResult.rows[0];
      // =============================
      // SELLER
      // =============================
      if (role === "seller") {
        const sellerResult = await pool.query(
          `
    INSERT INTO sellers
    (
      user_id,
      store_name,
      store_description,
      is_verified
    )
    VALUES
    ($1, $2, $3, $4)
    RETURNING id
    `,
          [user.id, store_name, store_description || null, false],
        );

        const sellerId = sellerResult.rows[0].id;

        // Create seller wallet
        await pool.query(
          `
    INSERT INTO seller_wallets (seller_id)
    VALUES ($1)
    `,
          [sellerId],
        );
      }
      await pool.query("COMMIT");

      const token = jwt.sign(
        {
          id: user.id,
          email: user.email,
          role: user.role,
        },
        JWT_SECRET,
        {
          expiresIn: JWT_EXPIRY,
        },
      );

      return res.status(201).json({
        message: "User registered successfully.",
        user,
        token,
      });
    } catch (error) {
      await pool.query("ROLLBACK");

      console.error("Registration error:", error);

      return res.status(500).json({
        message:
          error.response?.data?.message ||
          error.message ||
          "Registration failed.",
      });
    }
  },

  login: async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    try {
      // Find user by email
      const userResult = await pool.query(
        "SELECT * FROM users WHERE email = $1",
        [email],
      );

      if (userResult.rows.length === 0) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const user = userResult.rows[0];

      // Compare password
      const isPasswordValid = await bcrypt.compare(
        password,
        user.password_hash,
      );

      if (!isPasswordValid) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      // Create JWT token
      const token = jwt.sign(
        {
          id: user.id,
          email: user.email,
          role: user.role,
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY },
      );

      return res.status(200).json({
        message: "Login successful",
        user: {
          id: user.id,
          full_name: user.full_name,
          email: user.email,
          role: user.role,
        },
        token: token,
      });
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  },

  refreshToken: async (req, res) => {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ message: "Token is required" });
    }

    try {
      // Verify token
      const decoded = jwt.verify(token, JWT_SECRET);

      // Create new token
      const newToken = jwt.sign(
        {
          id: decoded.id,
          email: decoded.email,
          role: decoded.role,
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY },
      );

      return res.status(200).json({
        message: "Token refreshed successfully",
        token: newToken,
      });
    } catch (error) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
  },

  getCurrentUser: async (req, res) => {
    try {
      const userId = req.user.id;

      const userResult = await pool.query(
        "SELECT id, full_name, email, phone, role, created_at FROM users WHERE id = $1",
        [userId],
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }

      return res.status(200).json({
        message: "User retrieved successfully",
        user: userResult.rows[0],
      });
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  },
  getBanks: async (req, res) => {
    try {
      const response = await axios.get("https://api.paystack.co/bank", {
        params: {
          country: "nigeria",
          currency: "NGN",
        },
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      });

      const banks = response.data.data
        .map((bank) => ({
          name: bank.name,
          code: bank.code,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      return res.status(200).json({
        message: "Banks fetched successfully",
        banks,
      });
    } catch (error) {
      console.error("Get banks error:", error.response?.data || error.message);

      return res.status(500).json({
        message: "Unable to fetch bank list",
      });
    }
  },
  verifySellerBank: async (req, res) => {
    const { bank_name, bank_code, account_number, country } = req.body;
    const userId = req.user.id;

    if (!country) {
      return res.status(400).json({
        message: "Country is required",
      });
    }

    try {
      // Find seller profile
      const sellerResult = await pool.query(
        "SELECT id FROM sellers WHERE user_id = $1",
        [userId],
      );

      if (sellerResult.rowCount === 0) {
        return res.status(404).json({
          message: "Seller profile not found",
        });
      }

      const sellerId = sellerResult.rows[0].id;

      let accountName;
      let recipientCode;
      let finalBankName = bank_name || null;
      let finalBankCode = bank_code || null;
      let finalAccountNumber = account_number || null;

      // If seller is NOT Nigerian, use admin bank details
      if (country.toLowerCase() !== "nigeria") {
        const adminResult = await pool.query(
          `
        SELECT
          s.bank_name,
          s.bank_code,
          s.account_name,
          s.account_number,
          s.paystack_recipient_code
        FROM sellers s
        JOIN users u ON s.user_id = u.id
        WHERE u.role = 'admin'
        LIMIT 1
        `,
        );

        if (adminResult.rowCount === 0) {
          return res.status(500).json({
            message: "Admin bank details not configured",
          });
        }

        const adminBank = adminResult.rows[0];

        accountName = adminBank.account_name;
        recipientCode = adminBank.paystack_recipient_code;
        finalBankName = adminBank.bank_name;
        finalBankCode = adminBank.bank_code;
        finalAccountNumber = adminBank.account_number;
      } else {
        // Nigerian seller - verify account with Paystack
        if (!bank_name || !bank_code || !account_number) {
          return res.status(400).json({
            message: "Bank name, bank code and account number are required",
          });
        }

        // Resolve account
        const verifyResponse = await axios.get(
          "https://api.paystack.co/bank/resolve",
          {
            params: {
              account_number,
              bank_code,
            },
            headers: {
              Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            },
          },
        );

        accountName = verifyResponse.data.data.account_name;

        // Create transfer recipient
        const recipientResponse = await axios.post(
          "https://api.paystack.co/transferrecipient",
          {
            type: "nuban",
            name: accountName,
            account_number,
            bank_code,
            currency: "NGN",
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            },
          },
        );

        recipientCode = recipientResponse.data.data.recipient_code;
      }

      // Update seller bank details
      await pool.query(
        `
      UPDATE sellers
      SET
        bank_name = $1,
        bank_code = $2,
        account_name = $3,
        account_number = $4,
        paystack_recipient_code = $5,
        is_verified = true,
        updated_at = NOW()
      WHERE id = $6
      `,
        [
          finalBankName,
          finalBankCode,
          accountName,
          finalAccountNumber,
          recipientCode,
          sellerId,
        ],
      );

      return res.status(200).json({
        message: "Bank details verified successfully",
        account_name: accountName,
      });
    } catch (error) {
      console.error(
        "Seller bank verification error:",
        error,
      );

      return res.status(500).json({
        message:
          error.response?.data?.message ||
          error.message ||
          "Bank verification failed",
      });
    }
  },
};
