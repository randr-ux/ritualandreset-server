import express from "express";
import blogController from "../controller/blogController.js";
import upload from "../middleware/multer.js";
import {verifyToken} from "../middleware/auth.js";

const router = express.Router();

// Get all published blogs with pagination
router.get("/", blogController.getAllBlogs);
router.put("/edit/:id", verifyToken, upload.single("featured_image"), blogController.editBlog);

// Get latest blogs
router.get("/latest", blogController.latestBlogs);

router.get("/search", blogController.searchBlogs);

// Get blogs by category
router.get("/category/:slug", blogController.getBlogByCategory);

// Create a new blog post with image upload
router.post("/upload", verifyToken, upload.single("featured_image"), blogController.uploadBlog);

// Delete a blog post
router.delete("/:id", verifyToken, blogController.deleteBlog);

export default router;
