import express from "express";
import categoryController from "../controller/categoryController.js";
import { verifyToken, isAdmin } from "../middleware/auth.js"

const router = express.Router();

router.get("/", categoryController.getAllCategories);
router.post("/admin/create", verifyToken, categoryController.createCategory);
router.post("/seller/request", verifyToken, categoryController.createCategoryRequest);
router.patch("/admin/approve", verifyToken, categoryController.activateCategory);
router.patch("/admin/reject", verifyToken, categoryController.rejectCategory);
router.delete("/delete", categoryController.deleteCategory);

export default router;
