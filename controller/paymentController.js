import pool from "../config/db.js";
import axios from "axios";
import dotenv from "dotenv";
import crypto from "crypto";
import { sendEmail } from "../services/emailService.js";
import { buyerOrderEmail } from "../templates/buyerOrderEmail.js";
dotenv.config();

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const FRONTEND_URL = process.env.FRONTEND_URL;

const verifyPaystackTransaction = async (reference) => {
  
  const response = await axios.get(
    `https://api.paystack.co/transaction/verify/${reference}`,
    {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      },
    },
  );

  const payment = response.data.data;

  if (payment.status !== "success") {
    throw new Error("Payment verification failed.");
  }

  if (payment.currency !== "NGN") {
    throw new Error("Invalid payment currency.");
  }

  if (!payment.metadata?.checkoutId) {
    throw new Error("Checkout ID missing from metadata.");
  }

  return payment;
};

const paystackTransfer = async ({ recipient, amount }) => {
  if (!recipient) {
    throw new Error("Seller does not have a Paystack recipient code.");
  }

  const response = await axios.post(
    "https://api.paystack.co/transfer",
    {
      source: "balance",
      amount: Math.round(Number(amount) * 100), // Kobo
      recipient,
      reason: "Seller withdrawal",
    },
    {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    },
  );

  return response.data.data;
};

const processSuccessfulPayment = async (payment) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const reference = payment.reference;
    const checkoutId = payment.metadata.checkoutId;

    /* -----------------------------
        Lock checkout
    ------------------------------ */

    const checkoutResult = await client.query(
      `
      SELECT *
      FROM checkouts
      WHERE id = $1::uuid
      FOR UPDATE
      `,
      [checkoutId],
    );

    if (!checkoutResult.rows.length) {
      throw new Error("Checkout not found.");
    }

    const checkout = checkoutResult.rows[0];

    if (checkout.payment_status === "paid") {
      await client.query("ROLLBACK");

      return {
        alreadyProcessed: true,
        checkout,
      };
    }

    if (checkout.paystack_reference !== reference) {
      throw new Error("Reference mismatch.");
    }

    const expectedAmount = Math.round(Number(checkout.total_amount) * 100);

    if (payment.amount !== expectedAmount) {
      throw new Error("Payment amount mismatch.");
    }

    const ordersResult = await client.query(
      `
      SELECT *
      FROM orders
      WHERE checkout_id = $1::uuid
      `,
      [checkoutId],
    );

    const orders = ordersResult.rows;

    if (!orders.length) {
      throw new Error("No orders found.");
    }

    const walletMap = new Map();
    const stockValues = [];
    const stockPlaceholders = [];
    const sellerLedgerValues = [];
    const sellerLedgerPlaceholders = [];
    const platformLedgerValues = [];
    const platformLedgerPlaceholders = [];

    orders.forEach((order, index) => {
      /* ---------- Seller totals ---------- */

      if (!walletMap.has(order.seller_id)) {
        walletMap.set(order.seller_id, {
          pendingBalance: 0,
          lifetimeSales: 0,
        });
      }

      const seller = walletMap.get(order.seller_id);

      seller.pendingBalance += Number(order.seller_earning);
      seller.lifetimeSales += Number(order.subtotal);

      /* ---------- Stock ---------- */

      const stockOffset = index * 2;

      stockPlaceholders.push(`($${stockOffset + 1}, $${stockOffset + 2})`);

      stockValues.push(order.product_id, order.quantity);

      /* ---------- Seller ledger ---------- */

      const sellerOffset = index * 6;

      sellerLedgerPlaceholders.push(
        `($${sellerOffset + 1},$${sellerOffset + 2},$${sellerOffset + 3},$${sellerOffset + 4},$${sellerOffset + 5},$${sellerOffset + 6})`,
      );

      sellerLedgerValues.push(
        order.id,
        order.seller_id,
        order.seller_earning,
        "credit",
        "seller_sale",
        "seller",
      );

      /* ---------- Platform ledger ---------- */

      const platformOffset = index * 6;

      platformLedgerPlaceholders.push(
        `($${platformOffset + 1},$${platformOffset + 2},$${platformOffset + 3},$${platformOffset + 4},$${platformOffset + 5},$${platformOffset + 6})`,
      );

      platformLedgerValues.push(
        order.id,
        order.seller_id,
        order.commission_amount,
        "credit",
        "commission",
        "platform",
      );
    });

    /* =====================================================
            BULK STOCK UPDATE
    ====================================================== */

    await client.query(
      `
UPDATE products p

SET stock_quantity =
    p.stock_quantity - v.quantity::integer

FROM (
  VALUES
  ${stockPlaceholders.join(",")}
) AS v(id, quantity)

WHERE p.id = v.id::uuid
`,
      stockValues,
    );

    const pendingValues = [];
    const pendingPlaceholders = [];

    orders.forEach((order, index) => {
      const offset = index * 4;

      pendingPlaceholders.push(
        `
 ($${offset + 1},
  $${offset + 2},
  $${offset + 3},
  $${offset + 4})
 `,
      );

      pendingValues.push(
        order.seller_id,
        order.id,
        order.seller_earning,
        new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
      );
    });

    await client.query(
      `
INSERT INTO seller_pending_earnings
(
 seller_id,
 order_id,
 amount,
 available_at
)

VALUES
${pendingPlaceholders.join(",")}

`,
      pendingValues,
    );
    /* =====================================================
            BULK WALLET UPDATE
    ====================================================== */
    const walletValues = [];
    const walletPlaceholders = [];

    let walletIndex = 1;

    for (const [sellerId, totals] of walletMap.entries()) {
      walletPlaceholders.push(
        `($${walletIndex},$${walletIndex + 1},$${walletIndex + 2})`,
      );

      walletValues.push(sellerId, totals.pendingBalance, totals.lifetimeSales);

      walletIndex += 3;
    }

    await client.query(
      `
      UPDATE seller_wallets sw

      SET

        pending_balance =
            sw.pending_balance + v.pendingBalance::numeric,

        lifetime_sales =
            sw.lifetime_sales + v.sales::numeric,

        updated_at = NOW()

      FROM (

        VALUES

        ${walletPlaceholders.join(",")}

      ) AS v
      (
        seller_id,
        pendingBalance,
        sales
      )

      WHERE sw.seller_id = v.seller_id::uuid
      `,
      walletValues,
    );
    /* =====================================================
            BULK SELLER LEDGER
    ====================================================== */
    await client.query(
      `
      INSERT INTO earnings_ledger
(
 order_id,
 seller_id,
 amount,
 entry_type,
 source_type,
 beneficiary_type
)

SELECT
v.order_id::uuid,
v.seller_id::uuid,
v.amount::numeric,
v.entry_type,
v.source_type,
v.beneficiary_type

FROM (
VALUES
${sellerLedgerPlaceholders.join(",")}
)
AS v(
order_id,
seller_id,
amount,
entry_type,
source_type,
beneficiary_type
)
      `,
      sellerLedgerValues,
    );
    /* =====================================================
            BULK PLATFORM LEDGER
    ====================================================== */
    await client.query(
      `
      INSERT INTO earnings_ledger
(
 order_id,
 seller_id,
 amount,
 entry_type,
 source_type,
 beneficiary_type
)

SELECT
v.order_id::uuid,
v.seller_id::uuid,
v.amount::numeric,
v.entry_type,
v.source_type,
v.beneficiary_type

FROM (
VALUES
${platformLedgerPlaceholders.join(",")}
)
AS v(
order_id,
seller_id,
amount,
entry_type,
source_type,
beneficiary_type
)
      `,
      platformLedgerValues,
    );
    /* =====================================================
            UPDATE CHECKOUT
    ====================================================== */

    const updatedCheckout = await client.query(
      `
      UPDATE checkouts

      SET

        payment_status='paid',

        order_status='processing',

        payment_verified_at=NOW(),

        updated_at=NOW()

      WHERE id=$1::uuid

      RETURNING *
      `,
      [checkoutId],
    );

      const buyerResult = await client.query(
        `
  SELECT
    u.full_name,
    u.email
  FROM users u
  INNER JOIN checkouts c
    ON c.user_id = u.id
  WHERE c.id = $1
  `,
        [checkoutId],
      );

    const buyer = buyerResult.rows[0];

    await client.query("COMMIT");

    try {
      await sendEmail({
        to: 'oluwatimileyinadeosun@gmail.com',
        subject: "Your order has been confirmed",
        html: buyerOrderEmail({
          customerName: buyer.full_name,
          orderId: checkoutId,
        }),
      });
    } catch (err) {
      console.error("Failed to send buyer email:", err);
    }

    return {
      alreadyProcessed: false,
      checkout: updatedCheckout.rows[0],
    };
  } catch (error) {
    await client.query("ROLLBACK");

    throw error;
  } finally {
    client.release();
  }
};

export default {
  // Initialize checkout and create order
  initializeCheckout: async (req, res) => {
    const { items } = req.body;
    const userId = req.user.id;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        message: "At least one item is required.",
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Collect all product IDs
      const productIds = items.map((item) => item.productId);

      // Fetch all products and seller commission rates at once
      const productsResult = await client.query(
        `
      SELECT
        p.id,
        p.name,
        p.price,
        p.stock_quantity,
        p.status,
        p.seller_id,
        s.commission_rate
      FROM products p
      INNER JOIN sellers s
        ON p.seller_id = s.id
      WHERE p.id = ANY($1::uuid[])
      FOR UPDATE
      `,
        [productIds],
      );

      // Create lookup map
      const productsMap = new Map(
        productsResult.rows.map((product) => [product.id, product]),
      );

      let totalAmount = 0;
      const orderItems = [];

      for (const item of items) {
        if (!item.productId || !item.quantity || item.quantity <= 0) {
          throw new Error("Invalid product or quantity supplied.");
        }

        const product = productsMap.get(item.productId);

        if (!product) {
          throw new Error(`Product ${item.productId} not found.`);
        }

        if (product.status !== "approved") {
          throw new Error(`${product.name} is currently unavailable.`);
        }

        if (product.stock_quantity < item.quantity) {
          throw new Error(
            `${product.name} only has ${product.stock_quantity} item(s) remaining.`,
          );
        }

        const unitPrice = Number(product.price);
        const commissionRate = Number(product.commission_rate) / 100;

        const subtotal = unitPrice * item.quantity;
        const commissionAmount = subtotal * commissionRate;
        const sellerEarning = subtotal - commissionAmount;

        totalAmount += subtotal;

        orderItems.push({
          productId: product.id,
          sellerId: product.seller_id,
          quantity: item.quantity,
          unitPrice,
          subtotal,
          commissionAmount,
          sellerEarning,
        });
      }

      const checkoutResult = await client.query(
        `
      INSERT INTO checkouts
      (
        user_id,
        total_amount,
        payment_status,
        order_status
      )
      VALUES
      ($1, $2, 'pending', 'processing')
      RETURNING *
      `,
        [userId, totalAmount],
      );

      const checkout = checkoutResult.rows[0];

      const values = [];
      const placeholders = [];

      orderItems.forEach((item, index) => {
        const offset = index * 8;

        placeholders.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4},
      $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`,
        );

        values.push(
          checkout.id,
          item.productId,
          item.sellerId,
          item.quantity,
          item.unitPrice,
          item.subtotal,
          item.commissionAmount,
          item.sellerEarning,
        );
      });

      await client.query(
        `
  INSERT INTO orders
  (
    checkout_id,
    product_id,
    seller_id,
    quantity,
    unit_price,
    subtotal,
    commission_amount,
    seller_earning
  )
  VALUES
  ${placeholders.join(",")}
  `,
        values,
      );
      await client.query("COMMIT");

      return res.status(201).json({
        message: "Checkout created successfully.",
        checkout,
        totalAmount,
      });
    } catch (error) {
      await client.query("ROLLBACK");

      return res.status(500).json({
        message: error.message,
      });
    } finally {
      client.release();
    }
  },

  // Initialize payment with Paystack
  initializePayment: async (req, res) => {
    const { checkoutId } = req.body;
    const userId = req.user.id;

    if (!checkoutId) {
      return res.status(400).json({
        message: "Checkout ID is required.",
      });
    }

    try {
      // Fetch checkout and user together
      const checkoutResult = await pool.query(
        `
      SELECT
        c.*,
        u.email
      FROM checkouts c
      INNER JOIN users u
        ON u.id = c.user_id
      WHERE c.id = $1
        AND c.user_id = $2
      `,
        [checkoutId, userId],
      );

      if (!checkoutResult.rows.length) {
        return res.status(404).json({
          message: "Checkout not found.",
        });
      }

      const checkout = checkoutResult.rows[0];

      if (checkout.payment_status === "paid") {
        return res.status(400).json({
          message: "This checkout has already been paid.",
        });
      }

      // Make sure checkout still has orders
      const orderResult = await pool.query(
        `
      SELECT COUNT(*)::int AS total
      FROM orders
      WHERE checkout_id = $1
      `,
        [checkoutId],
      );

      if (orderResult.rows[0].total === 0) {
        return res.status(400).json({
          message: "This checkout contains no order items.",
        });
      }

      const paystackPayload = {
        email: checkout.email,
        amount: Math.round(Number(checkout.total_amount) * 100),
        callback_url: `${FRONTEND_URL}/payment/verify`,
        metadata: {
          checkoutId: checkout.id,
          userId,
        },
      };

      const paystackResponse = await axios.post(
        "https://api.paystack.co/transaction/initialize",
        paystackPayload,
        {
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
        },
      );

      const paymentData = paystackResponse.data.data;

      await pool.query(
        `
      UPDATE checkouts
      SET
        paystack_reference = $1,
        paystack_access_code = $2,
        payment_initialized_at = NOW(),
        updated_at = NOW()
      WHERE id = $3
      `,
        [paymentData.reference, paymentData.access_code, checkout.id],
      );

      return res.status(200).json({
        message: "Payment initialized successfully.",
        authorization_url: paymentData.authorization_url,
        access_code: paymentData.access_code,
        reference: paymentData.reference,
      });
    } catch (error) {
      if (error.response?.data?.message) {
        return res.status(400).json({
          message: error.response.data.message,
        });
      }

      return res.status(500).json({
        message: error.message,
      });
    }
  },

  // Verify payment and complete transaction
  verifyPayment: async (req, res) => {
    const { reference } = req.body;

    if (!reference) {
      return res.status(400).json({
        message: "Payment reference is required.",
      });
    }

    try {
      const payment = await verifyPaystackTransaction(reference);

      const result = await processSuccessfulPayment(payment);

      return res.status(200).json({
        message: result.alreadyProcessed
          ? "Payment already verified."
          : "Payment verified successfully.",

        checkout: result.checkout,
      });
    } catch (error) {
      return res.status(500).json({
        message: error.message,
      });
    }
  },

  paystackWebhook: async (req, res) => {
    try {
      const hash = crypto
        .createHmac("sha512", PAYSTACK_SECRET_KEY)
        .update(req.body)
        .digest("hex");

      if (hash !== req.headers["x-paystack-signature"]) {
        return res.sendStatus(401);
      }

      const event = JSON.parse(req.body);

      if (event.event !== "charge.success") {
        return res.sendStatus(200);
      }

      const payment = await verifyPaystackTransaction(event.data.reference);

      await processSuccessfulPayment(payment);

      return res.sendStatus(200);
    } catch (error) {
      console.error(error);

      return res.sendStatus(500);
    }
  },

  // Get checkout details
  getCheckout: async (req, res) => {
    const { checkoutId } = req.params;
    const userId = req.user.id;

    try {
      const checkoutResult = await pool.query(
        "SELECT * FROM checkouts WHERE id = $1 AND user_id = $2",
        [checkoutId, userId],
      );

      if (checkoutResult.rows.length === 0) {
        return res.status(404).json({ message: "Checkout not found" });
      }

      const checkout = checkoutResult.rows[0];

      // Get orders
      const ordersResult = await pool.query(
        `SELECT o.*, p.name, p.featured_image 
         FROM orders o 
         JOIN products p ON o.product_id = p.id 
         WHERE o.checkout_id = $1`,
        [checkoutId],
      );

      return res.status(200).json({
        checkout,
        orders: ordersResult.rows,
      });
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  },

  // Get user's checkouts
  getUserCheckouts: async (req, res) => {
    const userId = req.user.id;
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    try {
      const result = await pool.query(
        "SELECT * FROM checkouts WHERE user_id = $1 ORDER BY created_at DESC OFFSET $2 LIMIT $3",
        [userId, offset, limit],
      );

      return res.status(200).json(result.rows);
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  },

  // Cancel checkout (if payment not completed)
  cancelCheckout: async (req, res) => {
    const { checkoutId } = req.params;
    const userId = req.user.id;

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Get checkout
      const checkoutResult = await client.query(
        "SELECT * FROM checkouts WHERE id = $1 AND user_id = $2",
        [checkoutId, userId],
      );

      if (checkoutResult.rows.length === 0) {
        throw new Error("Checkout not found");
      }

      const checkout = checkoutResult.rows[0];

      if (checkout.payment_status === "paid") {
        throw new Error("Cannot cancel a paid checkout");
      }

      // Get orders to restore stock
      const ordersResult = await client.query(
        "SELECT * FROM orders WHERE checkout_id = $1",
        [checkoutId],
      );

      // Restore product stock
      for (const order of ordersResult.rows) {
        await client.query(
          "UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2",
          [order.quantity, order.product_id],
        );
      }

      // Delete orders
      await client.query("DELETE FROM orders WHERE checkout_id = $1", [
        checkoutId,
      ]);

      // Delete checkout
      await client.query("DELETE FROM checkouts WHERE id = $1", [checkoutId]);

      await client.query("COMMIT");

      return res
        .status(200)
        .json({ message: "Checkout cancelled successfully" });
    } catch (error) {
      await client.query("ROLLBACK");
      return res.status(500).json({ message: error.message });
    } finally {
      client.release();
    }
  },

  sellerWithdrawalRequest: async (req, res) => {
    const { amount } = req.body;
    const userId = req.user.id;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({
        message: "A valid withdrawal amount is required.",
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      /* ==========================================
        GET SELLER
    ========================================== */

      const sellerResult = await client.query(
        `
      SELECT id
      FROM sellers
      WHERE user_id = $1
      `,
        [userId],
      );

      if (!sellerResult.rows.length) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          message: "Seller account not found.",
        });
      }

      const sellerId = sellerResult.rows[0].id;

      /* ==========================================
        LOCK WALLET
    ========================================== */

      const walletResult = await client.query(
        `
      SELECT *
      FROM seller_wallets
      WHERE seller_id = $1
      FOR UPDATE
      `,
        [sellerId],
      );

      if (!walletResult.rows.length) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          message: "Seller wallet not found.",
        });
      }

      const wallet = walletResult.rows[0];

      if (Number(wallet.available_balance) < Number(amount)) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          message: "Insufficient available balance.",
        });
      }

      const updateWallet = await client.query(
        `
      UPDATE seller_wallets

SET

available_balance =
available_balance - $1,

reserved_balance =
reserved_balance + $1,

updated_at = NOW()

WHERE seller_id = $2;`,
        [amount, sellerId],
      );

      /* ==========================================
        CHECK EXISTING REQUEST
    ========================================== */

      const existingRequest = await client.query(
        `
      SELECT id
      FROM withdrawal_requests
      WHERE seller_id = $1
      AND status IN ('pending', 'processing')
      LIMIT 1
      `,
        [sellerId],
      );

      if (existingRequest.rows.length) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          message: "You already have a withdrawal request awaiting processing.",
        });
      }

      /* ==========================================
        CREATE REQUEST
    ========================================== */

      const requestResult = await client.query(
        `
      INSERT INTO withdrawal_requests
      (
        seller_id,
        amount,
        status
      )

      VALUES
      (
        $1,
        $2,
        'pending'
      )

      RETURNING *
      `,
        [sellerId, amount],
      );

      await client.query("COMMIT");

      return res.status(201).json({
        message: "Withdrawal request submitted successfully.",
        request: requestResult.rows[0],
      });
    } catch (error) {
      await client.query("ROLLBACK");

      return res.status(500).json({
        message: error.message,
      });
    } finally {
      client.release();
    }
  },

  decideSellerWithdrawalRequest: async (req, res) => {
    const { decision, requestId } = req.body;
    const adminId = req.user.id;

    if (!["approve", "reject"].includes(decision)) {
      return res.status(400).json({
        message: "Decision must be approve or reject.",
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      /* ==========================================
        VERIFY ADMIN
    ========================================== */

      const adminResult = await client.query(
        `
      SELECT role
      FROM users
      WHERE id = $1
      `,
        [adminId],
      );

      if (!adminResult.rows.length || adminResult.rows[0].role !== "admin") {
        await client.query("ROLLBACK");

        return res.status(403).json({
          message: "Unauthorized.",
        });
      }

      /* ==========================================
        LOCK REQUEST
    ========================================== */

      const requestResult = await client.query(
        `
      SELECT
        wr.*,
        s.paystack_recipient_code
      FROM withdrawal_requests wr
      JOIN sellers s
        ON s.id = wr.seller_id
      WHERE wr.id = $1
      FOR UPDATE
      `,
        [requestId],
      );

      if (!requestResult.rows.length) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          message: "Withdrawal request not found.",
        });
      }

      const request = requestResult.rows[0];

      if (request.status !== "pending") {
        await client.query("ROLLBACK");

        return res.status(400).json({
          message: "Request has already been processed.",
        });
      }

      /* ==========================================
        LOCK WALLET
    ========================================== */

      const walletResult = await client.query(
        `
      SELECT *
      FROM seller_wallets
      WHERE seller_id = $1
      FOR UPDATE
      `,
        [request.seller_id],
      );

      const wallet = walletResult.rows[0];

      /* ==========================================
        REJECT
    ========================================== */

      if (decision === "reject") {
        await client.query(
          `
        UPDATE seller_wallets
        SET
            available_balance =
                available_balance + $1,

            reserved_balance =
                reserved_balance - $1,

            updated_at = NOW()

        WHERE seller_id = $2
        `,
          [request.amount, request.seller_id],
        );

        await client.query(
          `
        UPDATE withdrawal_requests
        SET
            status = 'rejected',
            processed_at = NOW()
        WHERE id = $1
        `,
          [requestId],
        );

        await client.query("COMMIT");

        return res.status(200).json({
          message: "Withdrawal rejected.",
        });
      }

      /* ==========================================
        APPROVE
    ========================================== */

      await client.query(
        `
      UPDATE withdrawal_requests
      SET
          status='processing'
      WHERE id=$1
      `,
        [requestId],
      );

      const payoutResult = await client.query(
        `
      INSERT INTO seller_payouts
      (
          seller_id,
          withdrawal_request_id,
          amount,
          status
      )
      VALUES
      (
          $1,
          $2,
          $3,
          'pending'
      )
      RETURNING id
      `,
        [request.seller_id, request.id, request.amount],
      );

      await client.query("COMMIT");

      /* ==========================================
        PAYSTACK TRANSFER
    ========================================== */

      let transfer;

      try {
        transfer = await paystackTransfer({
          recipient: request.paystack_recipient_code,
          amount: request.amount,
        });
      } catch (error) {
        const rollbackClient = await pool.connect();

        try {
          await rollbackClient.query("BEGIN");

          await rollbackClient.query(
            `
          UPDATE seller_wallets
          SET

            available_balance =
                available_balance + $1,

            reserved_balance =
                reserved_balance - $1,

            updated_at = NOW()

          WHERE seller_id = $2
          `,
            [request.amount, request.seller_id],
          );

          await rollbackClient.query(
            `
          UPDATE withdrawal_requests
          SET

            status='failed',

            failure_reason=$1,

            processed_at=NOW()

          WHERE id=$2
          `,
            [error.message, request.id],
          );

          await rollbackClient.query(
            `
          UPDATE seller_payouts
          SET status='failed'
          WHERE id=$1
          `,
            [payoutResult.rows[0].id],
          );

          await rollbackClient.query("COMMIT");
        } catch (err) {
          await rollbackClient.query("ROLLBACK");
        } finally {
          rollbackClient.release();
        }

        return res.status(500).json({
          message: "Transfer failed.",
          error: error.message,
        });
      }

      /* ==========================================
        SUCCESS
    ========================================== */

      const successClient = await pool.connect();

      try {
        await successClient.query("BEGIN");

        await successClient.query(
          `
        UPDATE seller_wallets
        SET

            reserved_balance =
                reserved_balance - $1,

            updated_at = NOW()

        WHERE seller_id = $2
        `,
          [request.amount, request.seller_id],
        );

        await successClient.query(
          `
        UPDATE withdrawal_requests
        SET

            status='paid',

            paystack_reference=$1,

            paystack_transfer_code=$2,

            processed_at=NOW()

        WHERE id=$3
        `,
          [transfer.reference, transfer.transfer_code, request.id],
        );

        await successClient.query(
          `
        UPDATE seller_payouts
        SET

            status='success',

            paystack_reference=$1,

            paystack_transfer_code=$2

        WHERE id=$3
        `,
          [transfer.reference, transfer.transfer_code, payoutResult.rows[0].id],
        );

        await successClient.query(
          `
        INSERT INTO earnings_ledger
        (
            seller_id,
            amount,
            entry_type,
            source_type,
            beneficiary_type
        )
        VALUES
        (
            $1,
            $2,
            'debit',
            'withdrawal',
            'seller'
        )
        `,
          [request.seller_id, request.amount],
        );

        await successClient.query("COMMIT");

        return res.status(200).json({
          message: "Withdrawal approved successfully.",
        });
      } catch (error) {
        await successClient.query("ROLLBACK");

        throw error;
      } finally {
        successClient.release();
      }
    } catch (error) {
      await client.query("ROLLBACK");

      return res.status(500).json({
        message: error.message,
      });
    } finally {
      client.release();
    }
  },
  getCheckoutHistory: async (req, res) => {
    const userId = req.user.id;

    try {
      const result = await pool.query(
        `
        SELECT

          c.id AS checkout_id,
          c.total_amount,
          c.payment_status,
          c.order_status,
          c.created_at AS checkout_date,


          json_agg(
            json_build_object(

              'order_id', o.id,

              'product_id', p.id,
              'product_name', p.name,
              'product_image', p.featured_image,

              'quantity', o.quantity,
              'unit_price', o.unit_price,
              'subtotal', o.subtotal,


              'seller',
              json_build_object(
                'id', s.id,
                'store_name', s.store_name
              ),


              'review',
              CASE 
                WHEN r.id IS NOT NULL THEN
                  json_build_object(
                    'id', r.id,
                    'rating', r.rating,
                    'review', r.review,
                    'created_at', r.created_at
                  )

                ELSE NULL
              END,


              'has_review',
              CASE
                WHEN r.id IS NULL THEN false
                ELSE true
              END


            )
          ) AS products


        FROM checkouts c


        JOIN orders o
          ON o.checkout_id = c.id


        JOIN products p
          ON p.id = o.product_id


        JOIN sellers s
          ON s.id = o.seller_id


        LEFT JOIN reviews r
          ON r.product_id = p.id
          AND r.user_id = c.user_id


        WHERE 
          c.user_id = $1
          AND c.payment_status = 'paid'


        GROUP BY c.id


        ORDER BY c.created_at DESC

        `,
        [userId],
      );

      return res.status(200).json({
        history: result.rows,
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        message: error.message,
      });
    }
  },
};
