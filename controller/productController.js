import pool from "../config/db.js";
import { uploadProductImageToCloudinary } from "../utils/uploadToCloudinary.js";
import cloudinary from "../config/cloudinary.js";

const productQuery = `
SELECT 
    p.*,

    s.store_name,
    s.id AS seller_id,

    COALESCE(
        json_agg(
            DISTINCT jsonb_build_object(
                'id', c.id,
                'name', c.name,
                'slug', c.slug
            )
        ) FILTER (WHERE c.id IS NOT NULL),
        '[]'
    ) AS categories,


    COALESCE(
        json_agg(
            DISTINCT jsonb_build_object(
                'id', r.id,
                'rating', r.rating,
                'review', r.review,
                'created_at', r.created_at,
                'user',
                jsonb_build_object(
                    'id', u.id,
                    'name', u.full_name
                )
            )
        ) FILTER (WHERE r.id IS NOT NULL),
        '[]'
    ) AS reviews


FROM products p


JOIN sellers s
ON p.seller_id = s.id


LEFT JOIN product_categories pc
ON p.id = pc.product_id


LEFT JOIN categories c
ON pc.category_id = c.id


LEFT JOIN reviews r
ON p.id = r.product_id


LEFT JOIN users u
ON r.user_id = u.id
`;
function extractPublicId(url) {
  const parts = url.split("/upload/")[1];

  // Remove version if present
  const withoutVersion = parts.replace(/^v\d+\//, "");

  // Remove file extension
  return withoutVersion.replace(/\.[^/.]+$/, "");
}

export default {
  getAllProducts: async (req, res) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 100;

    const offset = (page - 1) * limit;

    try {
      const result = await pool.query(
        `
${productQuery}

WHERE p.status = 'approved' AND p.stock_quantity > 0

GROUP BY 
p.id,
s.id

ORDER BY p.created_at DESC

OFFSET $1
LIMIT $2

`,
        [offset, limit],
      );
      return res.status(200).json({
        products: result.rows,
      });
    } catch (error) {
      return res.status(500).json({
        message: error.message,
      });
    }
  },
  getProductById: async (req, res) => {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        message: "Product id is required",
      });
    }

    try {
      const result = await pool.query(
        `
${productQuery}

WHERE p.id=$1

GROUP BY
p.id,
s.id

`,
        [id],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "Product not found",
        });
      }

      return res.status(200).json(result.rows[0]);
    } catch (error) {
      return res.status(500).json({
        message: error.message,
      });
    }
  },
  getProductsByCategory: async (req, res) => {
    const { slugs } = req.query;

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 100;

    const offset = (page - 1) * limit;

    if (!slugs) {
      return res.status(400).json({
        message: "Category slugs are required",
      });
    }

    const categorySlugs = Array.isArray(slugs) ? slugs : slugs.split(",");

    try {
      const result = await pool.query(
        `
      ${productQuery}

      WHERE 
      p.status='approved'
      AND p.id IN (
    SELECT pc.product_id
    FROM product_categories pc
    JOIN categories c2
    ON pc.category_id = c2.id
    WHERE c2.slug = ANY($1)
)

      GROUP BY
      p.id,
      s.id

      ORDER BY p.created_at DESC

      OFFSET $2
      LIMIT $3
      `,
        [categorySlugs, offset, limit],
      );

      return res.status(200).json({
        message: "Products fetched successfully",
        products: result.rows,
      });
    } catch (error) {
      return res.status(500).json({
        message: error.message,
      });
    }
  },
  getProductBySeller: async (req, res) => {
    const { sellerId } = req.params;

    const page = Number(req.query.page) || 1;

    const limit = Number(req.query.limit) || 100;

    const offset = (page - 1) * limit;

    try {
      const result = await pool.query(
        `
${productQuery}

WHERE
p.seller_id=$1


GROUP BY
p.id,
s.id


ORDER BY p.created_at DESC


OFFSET $2
LIMIT $3

`,
        [sellerId, offset, limit],
      );

      return res.status(200).json({
        message: "Products retrieved successfully",

        products: result.rows,
      });
    } catch (error) {
      return res.status(500).json({
        message: error.message,
      });
    }
  },
  filterProducts: async (req, res) => {
    const { slug } = req.params;
    const { page, limit, sort } = req.query;
    const offset = (page - 1) * limit;

    let orderBy = "p.created_at DESC";

    if (sort === "price_inc") orderBy = "p.price ASC";
    if (sort === "price_dec") orderBy = "p.price DESC";
    if (sort === "newest") orderBy = "p.created_at DESC";
    if (sort === "oldest") orderBy = "p.created_at ASC";

    try {
      const result = await pool.query(
        `SELECT p.* FROM products p JOIN product_categories pc ON pc.product_id = p.id JOIN categories c ON c.id = pc.category_id WHERE c.slug = $1 ORDER BY ${orderBy} OFFSET $2 LIMIT $3`,
        [slug, offset, limit],
      );
      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ message: "No products found in this category" });
      }
      return res.status(200).json({
        message: "Products fetched successfully",
        products: result.rows,
      });
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  },
  uploadProduct: async (req, res) => {
    const client = await pool.connect();

    try {
      const file = req.file;

      const {
        name,
        description,
        price,
        stock_quantity,
        how_to_use,
        categories,
      } = req.body;

      const userId = req.user?.id;
      const userRole = req.user?.role;

      let productCategories = [];

      try {
        productCategories = categories ? JSON.parse(categories) : [];
      } catch (error) {
        return res.status(400).json({
          message: "Invalid category format",
        });
      }

      if (
        !name ||
        !price ||
        !userId ||
        productCategories.length === 0 ||
        !file
      ) {
        return res.status(400).json({
          message: "All fields are required",
        });
      }
      let status = "pending";
      if (userRole === "admin") {
        status = "approved";
      }

      const sellerResult = await client.query(
        `
      SELECT id 
      FROM sellers 
      WHERE user_id=$1
      `,
        [userId],
      );

      if (sellerResult.rowCount === 0) {
        return res.status(404).json({
          message: "Please create a seller account first",
        });
      }

      const sellerId = sellerResult.rows[0].id;

      const slug = name
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-");

      const slugCheck = await client.query(
        `
      SELECT id 
      FROM products 
      WHERE slug=$1
      `,
        [slug],
      );

      if (slugCheck.rowCount > 0) {
        return res.status(400).json({
          message: "Please use a unique product name",
        });
      }

      const featuredImage = await uploadProductImageToCloudinary(file);

      await client.query("BEGIN");

      const productResult = await client.query(
        `
      INSERT INTO products
      (
        seller_id,
        name,
        slug,
        description,
        price,
        stock_quantity,
        featured_image,
        how_to_use,
        status
      )

      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)

      RETURNING *
      `,
        [
          sellerId,
          name,
          slug,
          description || null,
          price,
          stock_quantity || 0,
          featuredImage,
          how_to_use || null,
          status,
        ],
      );

      const productId = productResult.rows[0].id;

      for (const categoryId of productCategories) {
        const categoryResult = await client.query(
          `
        SELECT id 
        FROM categories 
        WHERE id=$1
        `,
          [categoryId],
        );

        if (categoryResult.rowCount === 0) {
          throw new Error(`Category ${categoryId} does not exist`);
        }

        await client.query(
          `
        INSERT INTO product_categories
        (
          product_id,
          category_id
        )

        VALUES($1,$2)
        `,
          [productId, categoryId],
        );
      }

      await client.query("COMMIT");

      return res.status(201).json({
        message: "Product created successfully. An admin will approve shortly.",

        product: productResult.rows[0],
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error("upload product error:", error);

      return res.status(500).json({
        message: "Internal server error",
      });
    } finally {
      client.release();
    }
  },

  approveProduct: async (req, res) => {
    const { slug } = req.params;

    if (req.user.role !== "admin") {
      return res.status(403).json({
        message: "Not authorized",
      });
    }

    try {
      const response = await pool.query(
        `
      UPDATE products
      SET status = 'approved'
      WHERE slug = $1
      RETURNING *
      `,
        [slug],
      );

      if (response.rowCount === 0) {
        return res.status(404).json({
          message: "Product not found",
        });
      }

      return res.status(200).json({
        message: "Product approved successfully",
        product: response.rows[0],
      });
    } catch (error) {
      console.error("Approval error:", error);

      return res.status(500).json({
        message: "Server error while approving product",
      });
    }
  },

  declineProduct: async (req, res) => {
    const { slug } = req.params;

    if (req.user.role !== "admin") {
      return res.status(403).json({
        message: "Not authorized",
      });
    }

    try {
      const response = await pool.query(
        `
      UPDATE products
      SET status = 'rejected'
      WHERE slug = $1
      RETURNING *
      `,
        [slug],
      );

      if (response.rowCount === 0) {
        return res.status(404).json({
          message: "Product not found",
        });
      }

      return res.status(200).json({
        message: "Product declined successfully",
        product: response.rows[0],
      });
    } catch (error) {
      console.error("Decline error:", error);

      return res.status(500).json({
        message: "Server error while declining product",
      });
    }
  },

  editProduct: async (req, res) => {
    const client = await pool.connect();

    try {
      const { id } = req.params;

      const {
        name,
        description,
        price,
        stock_quantity,
        how_to_use,
        categories,
        status,
      } = req.body;

      if (!id) {
        return res.status(400).json({
          message: "Product ID is required",
        });
      }

      await client.query("BEGIN");

      // Check product exists
      const productCheck = await client.query(
        "SELECT * FROM products WHERE id = $1",
        [id],
      );

      if (productCheck.rows.length === 0) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          message: "Product not found",
        });
      }

      const existingProduct = productCheck.rows[0];

      let featuredImage = existingProduct.featured_image;

      // Upload image if supplied
      if (req.file) {
        featuredImage = await uploadProductImageToCloudinary(req.file);
      }

      // Generate slug if name changes
      let slug = existingProduct.slug;

      if (name && name !== existingProduct.name) {
        slug = name
          .toLowerCase()
          .replace(/[^\w\s-]/g, "")
          .replace(/\s+/g, "-");
      }

      // Update product
      const updateResult = await client.query(
        `
      UPDATE products
      SET
        name = COALESCE($1, name),
        slug = $2,
        description = COALESCE($3, description),
        price = COALESCE($4, price),
        stock_quantity = COALESCE($5, stock_quantity),
        featured_image = $6,
        how_to_use = COALESCE($7, how_to_use),
        status = COALESCE($8, status),
        updated_at = NOW()
      WHERE id = $9
      RETURNING *
      `,
        [
          name || null,
          slug,
          description || null,
          price || null,
          stock_quantity || null,
          featuredImage,
          how_to_use || null,
          status || null,
          id,
        ],
      );

      // Update categories
      if (categories) {
        const parsedCategories =
          typeof categories === "string" ? JSON.parse(categories) : categories;

        if (Array.isArray(parsedCategories)) {
          // Verify every category exists
          const existingCategories = await client.query(
            `
          SELECT id
          FROM categories
          WHERE id = ANY($1::uuid[])
          `,
            [parsedCategories],
          );

          if (existingCategories.rows.length !== parsedCategories.length) {
            await client.query("ROLLBACK");

            return res.status(400).json({
              message: "One or more selected categories do not exist.",
            });
          }

          // Remove old categories
          await client.query(
            "DELETE FROM product_categories WHERE product_id = $1",
            [id],
          );

          // Insert new categories
          for (const categoryId of parsedCategories) {
            await client.query(
              `
            INSERT INTO product_categories
            (product_id, category_id)
            VALUES ($1, $2)
            `,
              [id, categoryId],
            );
          }
        }
      }

      await client.query("COMMIT");

      return res.status(200).json({
        message: "Product updated successfully",
        product: updateResult.rows[0],
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

  productReview: async (req, res) => {
    const { productId } = req.params;
    const { rating, review } = req.body;
    const userId = req.user?.id;

    if (!productId || !rating || !userId) {
      return res.status(400).json({
        message: "Product ID, rating and user are required",
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Check if user already reviewed this product
      const existingReview = await client.query(
        `
      SELECT id
      FROM reviews
      WHERE product_id = $1
      AND user_id = $2
      `,
        [productId, userId],
      );

      if (existingReview.rowCount > 0) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          message: "You have already reviewed this product",
        });
      }
      // Check if user has purchased this product before
      const purchaseCheck = await client.query(
        `
      SELECT o.id
      FROM orders o
      JOIN checkouts c
      ON o.checkout_id = c.id
      WHERE c.user_id = $1
      AND o.product_id = $2
      AND c.payment_status = 'paid'
      LIMIT 1
      `,
        [userId, productId],
      );

      if (purchaseCheck.rowCount === 0) {
        await client.query("ROLLBACK");

        return res.status(403).json({
          message: "You can only review products you have purchased",
        });
      }

      // Insert review
      const result = await client.query(
        `
      INSERT INTO reviews
      (
        user_id,
        product_id,
        rating,
        review
      )
      VALUES($1,$2,$3,$4)
      RETURNING *
      `,
        [userId, productId, rating, review || null],
      );

      await client.query("COMMIT");

      return res.status(201).json({
        message: "Review submitted successfully",
        review: result.rows[0],
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

  editProductReview: async (req, res) => {
    const { reviewId } = req.params;
    const { rating, review } = req.body;
    const userId = req.user?.id;

    if (!reviewId || !rating || !userId) {
      return res.status(400).json({
        message: "Review ID, rating and user ID are required",
      });
    }

    try {
      const reviewCheck = await pool.query(
        `
      SELECT *
      FROM reviews
      WHERE id = $1
      AND user_id = $2
      `,
        [reviewId, userId],
      );

      if (reviewCheck.rows.length === 0) {
        return res.status(404).json({
          message:
            "Review not found or you are not authorized to edit this review",
        });
      }

      const updateResult = await pool.query(
        `
      UPDATE reviews
      SET 
        rating = $1,
        review = $2,
        updated_at = NOW()
      WHERE id = $3
      RETURNING *
      `,
        [rating, review || null, reviewId],
      );

      return res.status(200).json({
        message: "Review updated successfully",

        review: updateResult.rows[0],
      });
    } catch (error) {
      return res.status(500).json({
        message: error.message,
      });
    }
  },
  deleteProductReview: async (req, res) => {
    const { reviewId } = req.params;
    const userId = req.user?.id;

    try {
      const result = await pool.query(
        `
DELETE FROM reviews
WHERE id=$1
AND user_id=$2
RETURNING *
`,
        [reviewId, userId],
      );

      if (result.rowCount === 0) {
        return res.status(404).json({
          message: "Review not found or unauthorized",
        });
      }

      return res.status(200).json({
        message: "Review deleted successfully",
      });
    } catch (error) {
      return res.status(500).json({
        message: error.message,
      });
    }
  },
};
