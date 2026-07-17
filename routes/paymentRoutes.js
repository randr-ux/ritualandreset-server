import express from "express";
import paymentController from "../controller/paymentController.js";
import { verifyToken, isCustomer, isAdmin } from "../middleware/auth.js";

const router = express.Router();

// Customer routes (protected)
router.get("/checkout/history", verifyToken, paymentController.getCheckoutHistory);
router.get("/checkout/:checkoutId", verifyToken, paymentController.getCheckout);
router.get("/checkouts", verifyToken, paymentController.getUserCheckouts);
router.post("/checkout/initialize", verifyToken, paymentController.initializeCheckout);
router.post("/initialize", verifyToken, paymentController.initializePayment);
router.post("/verify", verifyToken, paymentController.verifyPayment);
router.post("/seller/request-withdrawal", verifyToken, paymentController.sellerWithdrawalRequest)
router.post("/admin/decide-withdrawal", verifyToken, paymentController.decideSellerWithdrawalRequest)

router.delete("/checkout/:checkoutId", verifyToken, paymentController.cancelCheckout);

export default router;
