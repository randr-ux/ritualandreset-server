import express from "express";
import productController from "../controller/productController.js";
import upload from "../middleware/multer.js";
import { verifyToken, isAdmin } from "../middleware/auth.js"

const router = express.Router();

// Get all products with pagination
router.get("/", productController.getAllProducts);

// Filter products by category and sort (specific route before /category/:slug)
router.get("/category/:slug/filter", productController.filterProducts);

// Get products by category
router.get("/category", productController.getProductsByCategory);

// Get product by ID (generic route comes last)
router.get("/:id", productController.getProductById);

// Create a new product with image upload
router.post(
  "/upload",
  verifyToken,
  upload.single("featured_image"),
  productController.uploadProduct,
);

// Update a product with optional image upload
router.put(
  "/:id",
  verifyToken,
  upload.single("featured_image"),
  productController.editProduct,
);
router.patch("/approve/:slug", verifyToken, isAdmin, productController.approveProduct);
router.patch("/decline/:slug", verifyToken, isAdmin, productController.declineProduct);

router.post("/review/:productId", verifyToken, productController.productReview);
router.patch("/review/:reviewId", verifyToken, productController.editProductReview);

export default router;
