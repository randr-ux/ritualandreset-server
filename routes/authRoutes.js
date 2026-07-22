import express from "express";
import authController from "../controller/authController.js";
import { verifyToken } from "../middleware/auth.js";

const router = express.Router();

// Public routes
router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/refresh-token", authController.refreshToken);
router.get("/banks", authController.getBanks);
router.post("/verify-bank", verifyToken, authController.verifySellerBank);

// Protected routes (requires authentication)
router.get("/me", verifyToken, authController.getCurrentUser);

export default router;
