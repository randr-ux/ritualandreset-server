import pool from "../config/db.js";
import { uploadBlogImageToCloudinary } from "../utils/uploadToCloudinary.js";
import cloudinary from "../config/cloudinary.js";

export default {
  getAllBlogs: async (req, res) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    try {
      const result = await pool.query(
        `
      SELECT
  bp.*,

  json_build_object(
    'id', u.id,
    'name', u.full_name
  ) AS author,

  COALESCE(
    json_agg(
      json_build_object(
        'id', c.id,
        'name', c.name,
        'slug', c.slug
      )
    ) FILTER (WHERE c.id IS NOT NULL),
    '[]'
  ) AS categories

FROM blog_posts bp

JOIN users u
  ON bp.author_id = u.id

LEFT JOIN blog_categories bc
  ON bp.id = bc.blog_id

LEFT JOIN categories c
  ON bc.category_id = c.id

WHERE bp.status = 'published'

GROUP BY bp.id, u.id

ORDER BY bp.published_at DESC

OFFSET $1
LIMIT $2
      `,
        [offset, limit],
      );

      ("sending blogs:", result.rows);
      return res.status(200).json({
        message: "Blogs fetched successfully",
        blogs: result.rows,
      });
    } catch (error) {
      return res.status(500).json({
        message: error.message,
      });
    }
  },

  latestBlogs: async (req, res) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 5;
    const offset = (page - 1) * limit;

    try {
      const result = await pool.query(
        `
      SELECT
  bp.*,

  json_build_object(
    'id', u.id,
    'name', u.full_name
  ) AS author,

  COALESCE(
    json_agg(
      json_build_object(
        'id', c.id,
        'name', c.name,
        'slug', c.slug
      )
    ) FILTER (WHERE c.id IS NOT NULL),
    '[]'
  ) AS categories

FROM blog_posts bp

JOIN users u
  ON bp.author_id = u.id

LEFT JOIN blog_categories bc
  ON bp.id = bc.blog_id

LEFT JOIN categories c
  ON bc.category_id = c.id

WHERE bp.status = 'published'

GROUP BY bp.id, u.id

ORDER BY bp.published_at DESC

LIMIT $1 OFFSET $2
      `,
        [limit, offset],
      );

      ("sending blogs:", result.rows);

      return res.status(200).json({
        message: "Latest blogs fetched successfully",
        blogs: result.rows,
      });
    } catch (error) {
      return res.status(500).json({
        message: error.message,
      });
    }
  },

  getBlogByCategory: async (req, res) => {
    const { slug } = req.params;

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    try {
      const result = await pool.query(
        `
      SELECT
  bp.*,

  json_build_object(
    'id', u.id,
    'name', u.full_name
  ) AS author,

  COALESCE(
    json_agg(
      json_build_object(
        'id', c2.id,
        'name', c2.name,
        'slug', c2.slug
      )
    ) FILTER (WHERE c2.id IS NOT NULL),
    '[]'
  ) AS categories

FROM blog_posts bp

JOIN users u
  ON bp.author_id = u.id

JOIN blog_categories bc_filter
  ON bp.id = bc_filter.blog_id

JOIN categories c_filter
  ON bc_filter.category_id = c_filter.id

LEFT JOIN blog_categories bc
  ON bp.id = bc.blog_id

LEFT JOIN categories c2
  ON bc.category_id = c2.id

WHERE c_filter.slug = $1
AND bp.status = 'published'

GROUP BY bp.id, u.id

ORDER BY bp.published_at DESC

OFFSET $2
LIMIT $3
      `,
        [slug, offset, limit],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "No blogs found in this category",
        });
      }

      return res.status(200).json(result.rows);
    } catch (error) {
      return res.status(500).json({
        message: error.message,
      });
    }
  },

  searchBlogs: async (req, res) => {
    try {
      const { author, title, sort } = req.query;

      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;
      const offset = (page - 1) * limit;
      const sortMap = {
        newest: "bp.published_at DESC",
        oldest: "bp.published_at ASC",
      };

      const orderBy = sortMap[sort] || sortMap.newest;

      let whereClause = "WHERE bp.status = 'published'";
      const values = [];
      let index = 1;

      if (author) {
        whereClause += ` AND u.full_name ILIKE $${index}`;
        values.push(`%${author}%`);
        index++;
      }

      if (title) {
        whereClause += ` AND bp.title ILIKE $${index}`;
        values.push(`%${title}%`);
        index++;
      }

      // Count total matching blogs
      const countQuery = `
      SELECT COUNT(*) AS total
      FROM blog_posts bp
      JOIN users u
        ON bp.author_id = u.id
      ${whereClause}
    `;

      const countResult = await pool.query(countQuery, values);
      const totalBlogs = Number(countResult.rows[0].total);

      if (totalBlogs === 0) {
        return res.status(404).json({
          message: "No blogs matched your search.",
        });
      }

      // Fetch paginated blogs
      const blogQuery = `
      SELECT
        bp.*,
        u.full_name AS author_name
      FROM blog_posts bp
      JOIN users u
        ON bp.author_id = u.id
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT $${index}
      OFFSET $${index + 1}
    `;

      const blogResult = await pool.query(blogQuery, [
        ...values,
        limit,
        offset,
      ]);

      return res.status(200).json({
        message: "Search successful.",
        pagination: {
          page,
          limit,
          totalBlogs,
          totalPages: Math.ceil(totalBlogs / limit),
          hasNextPage: page < Math.ceil(totalBlogs / limit),
          hasPreviousPage: page > 1,
        },
        blogs: blogResult.rows,
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        message: "Internal server error.",
      });
    }
  },

  uploadBlog: async (req, res) => {
    const { title, excerpt, content, categories } = req.body;
    const blogCategories = categories ? JSON.parse(categories) : [];
    const authorId = req.user?.id;
    const userRole = req.user?.role;

    if (!title || !content || !authorId || !req.file) {
      return res.status(400).json({
        message: "Title, content, author, and image are required",
      });
    }

    if (!["admin", "seller"].includes(userRole)) {
      return res.status(403).json({
        message: "Not authorized",
      });
    }

    const client = await pool.connect();

    let uploadedImage = null;

    try {
      await client.query("BEGIN");

      // Validate categories
      if (blogCategories.length > 0) {
        const categoryResult = await client.query(
          `
        SELECT id
        FROM categories
        WHERE id = ANY($1::uuid[])
        `,
          [blogCategories],
        );

        if (categoryResult.rows.length !== blogCategories.length) {
          await client.query("ROLLBACK");

          return res.status(400).json({
            message: "One or more selected categories are invalid.",
          });
        }
      }

      const slug = title
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-");

      const checkSlug = await pool.query(
        "SELECT * FROM blog_posts WHERE slug = $1",
        [slug],
      );

      if (checkSlug.rowCount > 0) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          message: "Please use a unique title.",
        });
      }

      // Upload image
      uploadedImage = await uploadBlogImageToCloudinary(req.file);

      const blogResult = await client.query(
        `
      INSERT INTO blog_posts
      (
        author_id,
        title,
        slug,
        excerpt,
        content,
        featured_image,
        status,
        published_at
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
      `,
        [
          authorId,
          title,
          slug,
          excerpt || null,
          content,
          JSON.stringify(uploadedImage), // JSONB
          "published",
          new Date(),
        ],
      );

      const blogId = blogResult.rows[0].id;

      for (const categoryId of blogCategories) {
        await client.query(
          `
        INSERT INTO blog_categories
        (blog_id, category_id)
        VALUES ($1,$2)
        `,
          [blogId, categoryId],
        );
      }

      await client.query("COMMIT");

      const completeBlog = await client.query(
        `
SELECT
  bp.*,

  json_build_object(
    'id', u.id,
    'name', u.full_name
  ) AS author

FROM blog_posts bp

JOIN users u
ON bp.author_id = u.id

WHERE bp.id = $1
`,
        [blogId],
      );

      return res.status(201).json({
        ...completeBlog.rows[0],
        categories: blogCategories,
      });
    } catch (error) {
      await client.query("ROLLBACK");

      // Remove uploaded image if database failed
      if (uploadedImage?.public_id) {
        try {
          await cloudinary.uploader.destroy(uploadedImage.public_id);
        } catch (cloudError) {
          console.error("Failed deleting uploaded image:", cloudError);
        }
      }

      return res.status(500).json({
        message: error.message,
      });
    } finally {
      client.release();
    }
  },
  deleteBlog: async (req, res) => {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        message: "Blog ID is required",
      });
    }

    try {
      const blogCheck = await pool.query(
        "SELECT * FROM blog_posts WHERE id = $1",
        [id],
      );

      if (blogCheck.rows.length === 0) {
        return res.status(404).json({
          message: "Blog not found",
        });
      }

      const blog = blogCheck.rows[0];

      // Delete Cloudinary image
      if (blog.featured_image?.public_id) {
        try {
          await cloudinary.uploader.destroy(blog.featured_image.public_id);
        } catch (cloudinaryError) {
          console.error(
            "Error deleting image from Cloudinary:",
            cloudinaryError,
          );

          return;
        }
      }

      // Delete blog
      await pool.query("DELETE FROM blog_posts WHERE id = $1", [id]);

      return res.status(200).json({
        message: "Blog deleted successfully",
      });
    } catch (error) {
      return res.status(500).json({
        message: error.message,
      });
    }
  },
  editBlog: async (req, res) => {
  const { id } = req.params;
  const { title, excerpt, content, categories } = req.body;
  
  const blogCategories = categories ? JSON.parse(categories) : [];
  const userId = req.user?.id;
  const userRole = req.user?.role;

  if (!id) {
    return res.status(400).json({
      message: "Blog ID is required.",
    });
  }

  if (!title || !content) {
    return res.status(400).json({
      message: "Title and content are required.",
    });
  }

  const client = await pool.connect();

  let uploadedImage = null;

  try {
    await client.query("BEGIN");

    // Check blog exists
    const blogResult = await client.query(
      `
      SELECT *
      FROM blog_posts
      WHERE id = $1
      `,
      [id],
    );

    if (blogResult.rowCount === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        message: "Blog not found.",
      });
    }

    const blog = blogResult.rows[0];

    // Authorization
    if (userRole !== "admin" && blog.author_id !== userId) {
      await client.query("ROLLBACK");

      return res.status(403).json({
        message: "Not authorized.",
      });
    }

    // Validate categories
    if (blogCategories.length > 0) {
      const categoryResult = await client.query(
        `
        SELECT id
        FROM categories
        WHERE id = ANY($1::uuid[])
        `,
        [blogCategories],
      );

      if (categoryResult.rows.length !== blogCategories.length) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          message: "One or more selected categories are invalid.",
        });
      }
    }

    // Generate slug
    const slug = title
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-");

    // Check slug uniqueness
    const slugCheck = await client.query(
      `
      SELECT id
      FROM blog_posts
      WHERE slug = $1
      AND id <> $2
      `,
      [slug, id],
    );

    if (slugCheck.rowCount > 0) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        message: "Please use a unique title.",
      });
    }

    const oldImage = blog.featured_image;
    let featuredImage = oldImage;

    // Upload new image if provided
    if (req.file) {
      uploadedImage = await uploadBlogImageToCloudinary(req.file);
      featuredImage = uploadedImage;
    }

    // Update blog
    await client.query(
      `
      UPDATE blog_posts
      SET
        title = $1,
        slug = $2,
        excerpt = $3,
        content = $4,
        featured_image = $5,
        updated_at = NOW()
      WHERE id = $6
      `,
      [
        title,
        slug,
        excerpt || null,
        content,
        JSON.stringify(featuredImage),
        id,
      ],
    );

    // Replace categories
    await client.query(
      `
      DELETE FROM blog_categories
      WHERE blog_id = $1
      `,
      [id],
    );

    for (const categoryId of blogCategories) {
      await client.query(
        `
        INSERT INTO blog_categories
        (blog_id, category_id)
        VALUES ($1, $2)
        `,
        [id, categoryId],
      );
    }

    await client.query("COMMIT");

    // Delete the old image AFTER successful commit
    if (
      req.file &&
      oldImage?.public_id &&
      oldImage.public_id !== uploadedImage.public_id
    ) {
      try {
        await cloudinary.uploader.destroy(oldImage.public_id);
      } catch (cloudError) {
        console.error(
          "Failed to delete old Cloudinary image:",
          cloudError,
        );
      }
    }

    // Fetch updated blog
    const updatedBlog = await client.query(
      `
      SELECT
        bp.*,

        json_build_object(
          'id', u.id,
          'name', u.full_name
        ) AS author,

        COALESCE(
          json_agg(
            json_build_object(
              'id', c.id,
              'name', c.name,
              'slug', c.slug
            )
          ) FILTER (WHERE c.id IS NOT NULL),
          '[]'
        ) AS categories

      FROM blog_posts bp

      JOIN users u
        ON bp.author_id = u.id

      LEFT JOIN blog_categories bc
        ON bp.id = bc.blog_id

      LEFT JOIN categories c
        ON bc.category_id = c.id

      WHERE bp.id = $1

      GROUP BY bp.id, u.id
      `,
      [id],
    );

    return res.status(200).json({
      message: "Blog updated successfully.",
      blog: updatedBlog.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");

    // Delete newly uploaded image if database update failed
    if (uploadedImage?.public_id) {
      try {
        await cloudinary.uploader.destroy(uploadedImage.public_id);
      } catch (cloudError) {
        console.error(
          "Failed deleting uploaded image:",
          cloudError,
        );
      }
    }

    return res.status(500).json({
      message: error.message,
    });
  } finally {
    client.release();
  }
},
};
