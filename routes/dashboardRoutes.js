import express from "express";
import {verifyToken, isAdmin, isSeller} from "../middleware/auth.js"
import dashboardController from "../controller/dashboardController.js"

const router = express.Router();

router.get("/seller", verifyToken, isSeller, dashboardController.sellerDashboard);
router.get("/admin", verifyToken, isAdmin, dashboardController.adminDashboard)

export default router;