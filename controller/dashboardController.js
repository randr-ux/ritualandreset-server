import pool from "../config/db.js";

export default {
  sellerDashboard: async (req, res) => {
    const userRole = req.user.role;
    const userId = req.user.id;

    if (userRole !== "seller") {
      return res.status(403).json({
        message: "Nothing to see",
      });
    }

    try {
      // Get seller id
      const sellerResult = await pool.query(
        `
        SELECT id
        FROM sellers
        WHERE user_id = $1
        `,
        [userId],
      );

      if (sellerResult.rows.length === 0) {
        return res.status(404).json({
          message: "Seller profile not found",
        });
      }

      const sellerId = sellerResult.rows[0].id;
      const dashboardResult = await pool.query(
        `
        SELECT

        -- Seller profile
        json_build_object(
          'id', s.id,
          'store_name', s.store_name,
          'store_description', s.store_description,
          'is_verified', s.is_verified,
          'commission_rate', s.commission_rate
        ) AS seller,


        -- Products
        COALESCE(
          (
            SELECT json_agg(product_data ORDER BY product_data.created_at DESC)
FROM (

    SELECT
        p.*,

        COALESCE(
            json_agg(
                DISTINCT jsonb_build_object(
                    'id', c.id,
                    'name', c.name,
                    'slug', c.slug
                )
            ) FILTER (WHERE c.id IS NOT NULL),
            '[]'
        ) AS categories

    FROM products p

    LEFT JOIN product_categories pc
        ON pc.product_id = p.id

    LEFT JOIN categories c
        ON c.id = pc.category_id

    WHERE p.seller_id = s.id

    GROUP BY p.id

) product_data
          ),
          '[]'
        ) AS products,


        -- Blogs
        COALESCE(
          (
            SELECT json_agg(bp ORDER BY bp.created_at DESC)
            FROM blog_posts bp
            WHERE bp.author_id = s.user_id
          ),
          '[]'
        ) AS blogs,


        -- Orders
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', o.id,
                'product_id', o.product_id,
                'quantity', o.quantity,
                'unit_price', o.unit_price,
                'subtotal', o.subtotal,
                'seller_earning', o.seller_earning,
                'created_at', o.created_at,

                'product',
                json_build_object(
                  'name', p.name,
                  'image', p.featured_image
                )
              )
              ORDER BY o.created_at DESC
            )
            FROM orders o

            JOIN products p
            ON p.id = o.product_id

            WHERE o.seller_id = s.id
          ),
          '[]'
        ) AS orders,



        -- Payments / earnings
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', el.id,
                'amount', el.amount,
                'entry_type', el.entry_type,
                'source_type', el.source_type,
                'beneficiary_type', el.beneficiary_type,
                'created_at', el.created_at
              )
              ORDER BY el.created_at DESC
            )
            FROM earnings_ledger el
            WHERE el.seller_id = s.id
          ),
          '[]'
        ) AS payments,


        -- Wallet
        (
          SELECT row_to_json(sw)
          FROM seller_wallets sw
          WHERE sw.seller_id = s.id
        ) AS wallet,


        -- Withdrawals
        COALESCE(
          (
            SELECT json_agg(wr ORDER BY wr.created_at DESC)
            FROM withdrawal_requests wr
            WHERE wr.seller_id = s.id
          ),
          '[]'
        ) AS withdrawals


        FROM sellers s

        WHERE s.id = $1

        GROUP BY s.id
        `,
        [sellerId],
      );

      return res.status(200).json({
        message: "Dashboard fetched successfully",
        dashboard: dashboardResult.rows[0],
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        message: error.message,
      });
    }
  },

  adminDashboard: async (req, res) => {
    try {
      const [
        overviewResult,
        productsResult,
        pendingProductsResult,
        categoryRequestsResult,
        ordersResult,
        paymentsResult,
        withdrawalsResult,
        payoutsResult,
        sellersResult,
        blogsResult,
        activityResult,
      ] = await Promise.all([
        // =========================
        // OVERVIEW METRICS
        // =========================
        pool.query(`
        SELECT

        (SELECT COUNT(*) FROM users) AS total_users,

        (SELECT COUNT(*) FROM orders) AS total_orders,

        (
          SELECT COALESCE(SUM(total_amount),0)
          FROM checkouts
          WHERE payment_status='paid'
        ) AS total_revenue,

        (
          SELECT COALESCE(SUM(commission_amount),0)
          FROM orders
        ) AS total_commission,

        (
          SELECT COUNT(*)
          FROM orders
          WHERE created_at::date = CURRENT_DATE
        ) AS orders_today,

        (
          SELECT COUNT(*)
          FROM withdrawal_requests
          WHERE status='pending'
        ) AS pending_withdrawals
      `),

        // =========================
        // ALL PRODUCTS
        // =========================
        pool.query(`
       SELECT
    p.*,

    s.store_name,

    u.full_name AS seller_name,

    approver.full_name AS approved_by_name,

    COALESCE(
        json_agg(
            DISTINCT jsonb_build_object(
                'id', c.id,
                'name', c.name,
                'slug', c.slug
            )
        ) FILTER (WHERE c.id IS NOT NULL),
        '[]'
    ) AS categories

FROM products p

JOIN sellers s
    ON p.seller_id = s.id

JOIN users u
    ON s.user_id = u.id

LEFT JOIN users approver
    ON p.approved_by = approver.id

LEFT JOIN product_categories pc
    ON pc.product_id = p.id

LEFT JOIN categories c
    ON c.id = pc.category_id

WHERE u.role = 'admin'

GROUP BY
    p.id,
    s.store_name,
    u.full_name,
    approver.full_name

ORDER BY p.created_at DESC;
      `),

        // =========================
        // PRODUCT APPROVAL REQUESTS
        // =========================
        pool.query(`
        SELECT

    p.*,

    s.store_name,

    COALESCE(
        json_agg(
            DISTINCT jsonb_build_object(
                'id', c.id,
                'name', c.name,
                'slug', c.slug
            )
        ) FILTER (WHERE c.id IS NOT NULL),
        '[]'
    ) AS categories

FROM products p

JOIN sellers s
    ON p.seller_id = s.id

LEFT JOIN product_categories pc
    ON pc.product_id = p.id

LEFT JOIN categories c
    ON c.id = pc.category_id

WHERE p.status = 'pending'

GROUP BY
    p.id,
    s.store_name

ORDER BY p.created_at DESC;
      `),

        // =========================
        // CATEGORY REQUESTS
        // =========================
        pool.query(`
        SELECT
          cr.*,
          s.store_name

        FROM category_requests cr

        JOIN sellers s
        ON cr.seller_id=s.id

        WHERE cr.status='pending'

        ORDER BY cr.created_at DESC
      `),

        // =========================
        // ORDERS
        // =========================
        pool.query(`
        SELECT

        o.*,

        c.total_amount,
        c.order_status,
        c.payment_status,

        u.full_name AS customer_name,

        p.name AS product_name,
        p.featured_image,

        s.store_name


        FROM orders o

        JOIN checkouts c
        ON o.checkout_id=c.id

        JOIN users u
        ON c.user_id=u.id

        JOIN products p
        ON o.product_id=p.id

        JOIN sellers s
        ON o.seller_id=s.id

        ORDER BY o.created_at DESC
      `),

        // =========================
        // CUSTOMER PAYMENTS
        // =========================
        pool.query(`
        SELECT

        id,
        total_amount,
        payment_status,
        paystack_reference,
        created_at

        FROM checkouts

        ORDER BY created_at DESC
      `),

        // =========================
        // WITHDRAWALS
        // =========================
        pool.query(`
        SELECT

        wr.*,

        s.store_name

        FROM withdrawal_requests wr

        JOIN sellers s
        ON wr.seller_id=s.id

        ORDER BY wr.created_at DESC
      `),

        // =========================
        // SELLER PAYOUTS
        // =========================
        pool.query(`
        SELECT

        sp.*,

        s.store_name

        FROM seller_payouts sp

        JOIN sellers s
        ON sp.seller_id=s.id

        ORDER BY sp.created_at DESC
      `),

        // =========================
        // SELLERS
        // =========================
        pool.query(`
        SELECT

        s.*,

        u.full_name,
        u.email,

        sw.lifetime_sales,
        sw.available_balance,
        sw.lifetime_commissions

        FROM sellers s

        JOIN users u
        ON s.user_id=u.id

        LEFT JOIN seller_wallets sw
        ON s.id=sw.seller_id

        ORDER BY s.created_at DESC
      `),

        // =========================
        // ADMIN BLOGS
        // =========================
        pool.query(`
        SELECT

        bp.*,

        u.full_name AS author

        FROM blog_posts bp

        JOIN users u
        ON bp.author_id=u.id

        WHERE u.role='admin'

        ORDER BY bp.created_at DESC
      `),

        // =========================
        // RECENT ACTIVITY
        // =========================
        pool.query(`
        SELECT *
        FROM (

          SELECT
          'New product uploaded' AS type,
          name AS title,
          created_at

          FROM products


          UNION ALL


          SELECT
          'New order',
          id::text,
          created_at

          FROM orders


          UNION ALL


          SELECT
          'Withdrawal request',
          id::text,
          created_at

          FROM withdrawal_requests


          UNION ALL


          SELECT
          'New user',
          full_name,
          created_at

          FROM users

        ) activity

        ORDER BY created_at DESC

        LIMIT 10
      `),
      ]);

      return res.status(200).json({
        message: "Dashboard fetched successfully",

        dashboard: {
          overview: overviewResult.rows[0],

          products: {
            all: productsResult.rows,
            pending: pendingProductsResult.rows,
            category_requests: categoryRequestsResult.rows,
          },

          orders: ordersResult.rows,

          payments: {
            customer_payments: paymentsResult.rows,
            withdrawals: withdrawalsResult.rows,
            payouts: payoutsResult.rows,
          },

          sellers: sellersResult.rows,

          blogs: blogsResult.rows,

          recent_activity: activityResult.rows,
        },
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        message: error.message,
      });
    }
  },
};
