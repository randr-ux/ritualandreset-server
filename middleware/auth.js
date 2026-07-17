import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

// Middleware to verify JWT token
export const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ message: "No token provided" });
  }

  // Extract token from "Bearer <token>"
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Token expired" });
    }
    return res.status(401).json({ message: "Invalid token" });
  }
};

// Middleware to check if user is admin
export const isAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  if (req.user.role !== "admin") {
    return res
      .status(403)
      .json({ message: "Access denied. Admin role required" });
  }

  next();
};

// Middleware to check if user is seller
export const isSeller = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  if (req.user.role !== "seller") {
    return res
      .status(403)
      .json({ message: "Access denied. Seller role required" });
  }

  next();
};

// Middleware to check if user is customer
export const isCustomer = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  if (req.user.role !== "customer") {
    return res
      .status(403)
      .json({ message: "Access denied. Customer role required" });
  }

  next();
};

// Middleware to check if user is seller or admin
export const isSellerOrAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  if (!["seller", "admin"].includes(req.user.role)) {
    return res
      .status(403)
      .json({ message: "Access denied. Seller or Admin role required" });
  }

  next();
};
