import pool from "../config/db.js";

export default {
  getAllCategories: async (req, res) => {
    try {
      const categoryResults = await pool.query(
        `
      SELECT *
      FROM categories
      WHERE status = 'active'
      ORDER BY name ASC
      `,
      );
      return res.status(200).json({
        message: "Categories fetched successfully",
        categories: categoryResults.rows,
      });
    } catch (error) {
      console.error("Error fetching categories:", error);

      return res.status(500).json({
        message: "Server error",
        error: error.message,
      });
    }
  },
  createCategory: async (req, res) => {
    const { name, description } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (!name?.trim() || !description?.trim()) {
      return res.status(400).json({
        message: "Category name and description are required",
      });
    }

    if (userRole !== "admin") {
      return res.status(403).json({
        message: "You are not authorized to create a category",
      });
    }

    const categoryName = name.trim();

    const slug = categoryName
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    try {
      // Check if category name already exists
      const existingCategory = await pool.query(
        `
      SELECT id
      FROM categories
      WHERE LOWER(name) = LOWER($1)
      `,
        [categoryName],
      );

      if (existingCategory.rowCount > 0) {
        return res.status(400).json({
          message: "Category already exists",
        });
      }

      // Check if generated slug already exists
      const existingSlug = await pool.query(
        `
      SELECT id
      FROM categories
      WHERE slug = $1
      `,
        [slug],
      );

      if (existingSlug.rowCount > 0) {
        return res.status(400).json({
          message: "A category with a similar name already exists.",
        });
      }

      const newCategory = await pool.query(
        `
      INSERT INTO categories
      (name, slug, description, status, created_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
        [categoryName, slug, description.trim(), "active", userId],
      );

      return res.status(201).json({
        message: "Category created successfully",
        category: newCategory.rows[0],
      });
    } catch (error) {
      console.error("Create category error:", error);

      return res.status(500).json({
        message: "Server error",
        error: error.message,
      });
    }
  },
  createCategoryRequest: async (req, res) => {
    const { name, description } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (!name?.trim() || !description?.trim()) {
      return res.status(400).json({
        message: "Category name and description are required",
      });
    }

    if (userRole !== "seller") {
      return res.status(403).json({
        message: "You are not authorized to submit a category request",
      });
    }

    const categoryName = name.trim();

    try {
      // Ensure the user is a registered seller
      const sellerResult = await pool.query(
        `
      SELECT id
      FROM sellers
      WHERE user_id = $1
      `,
        [userId],
      );

      if (sellerResult.rowCount === 0) {
        return res.status(404).json({
          message:
            "Please create a seller account before requesting a category.",
        });
      }

      const sellerId = sellerResult.rows[0].id;

      // Check if category already exists
      const existingCategory = await pool.query(
        `
      SELECT id
      FROM categories
      WHERE LOWER(name) = LOWER($1)
      `,
        [categoryName],
      );

      if (existingCategory.rowCount > 0) {
        return res.status(400).json({
          message: "Category already exists.",
        });
      }

      // Check if a pending request already exists
      const existingRequest = await pool.query(
        `
      SELECT id
      FROM category_requests
      WHERE LOWER(name) = LOWER($1)
      AND status = 'pending'
      `,
        [categoryName],
      );

      if (existingRequest.rowCount > 0) {
        return res.status(400).json({
          message: "A request for this category is already pending.",
        });
      }

      const newRequest = await pool.query(
        `
      INSERT INTO category_requests
      (name, description, seller_id, status)
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
        [categoryName, description.trim(), sellerId, "pending"],
      );

      return res.status(201).json({
        message: "Category request submitted successfully.",
        category: newRequest.rows[0],
      });
    } catch (error) {
      console.error("Create category request error:", error);

      return res.status(500).json({
        message: "Server error",
        error: error.message,
      });
    }
  },
  rejectCategory: async (req, res) => {
    const { name } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (!name?.trim()) {
      return res.status(400).json({
        message: "Category name is required.",
      });
    }

    if (userRole !== "admin") {
      return res.status(403).json({
        message: "You are not authorized to activate a category.",
      });
    }

    const categoryName = name.trim();

    try {
      await pool.query("BEGIN");

      // Find the pending request
      const requestResult = await pool.query(
        `
      SELECT *
      FROM category_requests
      WHERE LOWER(name) = LOWER($1)
      AND status = 'pending'
      `,
        [categoryName],
      );

      if (requestResult.rowCount === 0) {
        await pool.query("ROLLBACK");

        return res.status(404).json({
          message: "No pending request found for this category.",
        });
      }

      const request = requestResult.rows[0];

      // Mark request as approved
      await pool.query(
        `
      UPDATE category_requests
      SET
        status = 'rejected',
        reviewed_by = $1,
        reviewed_at = CURRENT_TIMESTAMP
      WHERE id = $2
      `,
        [userId, request.id],
      );

      await pool.query("COMMIT");

      return res.status(200).json({
        message: "Category rejected successfully.",
        category: categoryResult.rows[0],
      });
    } catch (error) {
      await pool.query("ROLLBACK");

      console.error("Activate category error:", error);

      return res.status(500).json({
        message: "Server error",
        error: error.message,
      });
    }
  },
  activateCategory: async (req, res) => {
    const { name } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (!name?.trim()) {
      return res.status(400).json({
        message: "Category name is required.",
      });
    }

    if (userRole !== "admin") {
      return res.status(403).json({
        message: "You are not authorized to activate a category.",
      });
    }

    const categoryName = name.trim();

    try {
      await pool.query("BEGIN");

      // Find the pending request
      const requestResult = await pool.query(
        `
      SELECT *
      FROM category_requests
      WHERE LOWER(name) = LOWER($1)
      AND status = 'pending'
      `,
        [categoryName],
      );

      if (requestResult.rowCount === 0) {
        await pool.query("ROLLBACK");

        return res.status(404).json({
          message: "No pending request found for this category.",
        });
      }

      const request = requestResult.rows[0];

      // Prevent duplicate categories
      const existingCategory = await pool.query(
        `
      SELECT id
      FROM categories
      WHERE LOWER(name) = LOWER($1)
      `,
        [request.name],
      );

      if (existingCategory.rowCount > 0) {
        await pool.query("ROLLBACK");

        return res.status(400).json({
          message: "Category already exists.",
        });
      }

      // Convert seller_id -> user_id
      const sellerResult = await pool.query(
        `
      SELECT user_id
      FROM sellers
      WHERE id = $1
      `,
        [request.seller_id],
      );

      if (sellerResult.rowCount === 0) {
        await pool.query("ROLLBACK");

        return res.status(404).json({
          message: "Seller not found.",
        });
      }

      const createdBy = sellerResult.rows[0].user_id;

      const slug = request.name
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

      // Create category
      const categoryResult = await pool.query(
        `
      INSERT INTO categories
      (name, slug, description, status, created_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
        [request.name, slug, request.description, "active", createdBy],
      );

      // Mark request as approved
      await pool.query(
        `
      UPDATE category_requests
      SET
        status = 'approved',
        reviewed_by = $1,
        reviewed_at = CURRENT_TIMESTAMP
      WHERE id = $2
      `,
        [userId, request.id],
      );

      await pool.query("COMMIT");

      return res.status(200).json({
        message: "Category activated successfully.",
        category: categoryResult.rows[0],
      });
    } catch (error) {
      await pool.query("ROLLBACK");

      console.error("Activate category error:", error);

      return res.status(500).json({
        message: "Server error",
        error: error.message,
      });
    }
  },
  deleteCategory: async (req, res) => {
    const { names } = req.body;
    const userRole = req.user.role;

    if (userRole !== "admin") {
      return res.status(403).json({
        message: "You are not authorized to delete categories.",
      });
    }

    if (!Array.isArray(names) || names.length === 0) {
      return res.status(400).json({
        message: "Names must be a non-empty array.",
      });
    }

    // Prevent deleting the default category
    const filteredNames = names
      .map((name) => name.trim())
      .filter((name) => name.toLowerCase() !== "others");

    if (filteredNames.length === 0) {
      return res.status(400).json({
        message: "The default 'Others' category cannot be deleted.",
      });
    }

    try {
      // Find existing active categories
      const existingCategories = await pool.query(
        `
      SELECT name
      FROM categories
      WHERE LOWER(name) = ANY(
        SELECT LOWER(unnest($1::text[]))
      )
      AND status = 'active'
      `,
        [filteredNames],
      );

      if (existingCategories.rowCount === 0) {
        return res.status(404).json({
          message: "No matching active categories found.",
        });
      }

      const existingNames = existingCategories.rows.map((c) => c.name);

      const notFound = filteredNames.filter(
        (name) =>
          !existingNames.some(
            (existing) => existing.toLowerCase() === name.toLowerCase(),
          ),
      );

      // Soft delete
      const updatedCategories = await pool.query(
        `
      UPDATE categories
      SET
        status = 'inactive',
        updated_at = CURRENT_TIMESTAMP
      WHERE name = ANY($1)
      RETURNING *
      `,
        [existingNames],
      );

      return res.status(200).json({
        message: `${updatedCategories.rowCount} category(s) deactivated successfully.`,
        deactivatedCategories: updatedCategories.rows,
        notFound,
      });
    } catch (error) {
      console.error("Delete category error:", error);

      return res.status(500).json({
        message: "Server error",
        error: error.message,
      });
    }
  },
};
