import type { Express } from "express";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import multer from "multer";
import path from "path";
import { storage } from "./storage";
import { registerUserSchema, loginSchema, insertGrantApplicationSchema, updateGrantApplicationStatusSchema } from "@shared/schema";

// Configure multer for file uploads
const upload = multer({
  dest: "uploads/",
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [".pdf", ".doc", ".docx"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF and DOC files are allowed"));
    }
  },
});

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: "Too many authentication attempts, please try again later",
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: "Too many requests, please try again later",
});

// Middleware to verify JWT token
function authenticateToken(req: any, res: any, next: any) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Access token required" });
  }

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) {
      return res.status(403).json({ message: "Invalid or expired token" });
    }
    req.user = user;
    next();
  });
}

// Middleware to check admin role
function requireAdmin(req: any, res: any, next: any) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

export async function registerRoutes(app: Express) {
  // Apply general rate limiting to all API routes
  app.use("/api", apiLimiter);

  // Authentication routes
  app.post("/api/auth/register", authLimiter, async (req, res) => {
    try {
      // Use public registration schema that omits role field
      const validatedData = registerUserSchema.parse(req.body);
      
      // Check if user already exists
      const existingUser = await storage.getUserByEmail(validatedData.email);
      if (existingUser) {
        return res.status(400).json({ message: "Email already registered" });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(validatedData.password, 10);
      
      // SECURITY: Always set role to "user" for public registration
      // Role field is not accepted from client input
      // Admins must be created through a separate secure process
      const user = await storage.createUser({
        ...validatedData,
        password: hashedPassword,
        role: "user", // Server-side only - never from client
      });

      // Generate JWT token
      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: "7d" }
      );

      // Remove password from response
      const { password, ...userWithoutPassword } = user;
      
      res.status(201).json({ user: userWithoutPassword, token });
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid input data", errors: error.errors });
      }
      res.status(500).json({ message: "Registration failed" });
    }
  });

  app.post("/api/auth/login", authLimiter, async (req, res) => {
    try {
      const validatedData = loginSchema.parse(req.body);
      
      // Find user
      const user = await storage.getUserByEmail(validatedData.email);
      if (!user) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(validatedData.password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      // Generate JWT token
      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: "7d" }
      );

      // Remove password from response
      const { password, ...userWithoutPassword } = user;
      
      res.json({ user: userWithoutPassword, token });
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid input data", errors: error.errors });
      }
      res.status(500).json({ message: "Login failed" });
    }
  });

  // Grant application routes
  app.get("/api/applications", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const applications = await storage.getAllApplications();
      res.json(applications);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch applications" });
    }
  });

  app.get("/api/applications/user/:userId", authenticateToken, async (req, res) => {
    try {
      const { userId } = req.params;
      
      // Users can only view their own applications, admins can view any
      if (req.user.role !== "admin" && req.user.id !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const applications = await storage.getApplicationsByUser(userId);
      res.json(applications);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch applications" });
    }
  });

  app.post("/api/applications", authenticateToken, upload.single("file"), async (req, res) => {
    try {
      // Parse JSON data from multipart form
      const applicationData = JSON.parse(req.body.data || "{}");
      const validatedData = insertGrantApplicationSchema.parse(applicationData);
      
      // Ensure userId matches authenticated user (unless admin)
      if (req.user.role !== "admin" && validatedData.userId !== req.user.id) {
        return res.status(403).json({ message: "Cannot create application for another user" });
      }

      // Handle file upload if present
      if (req.file) {
        validatedData.fileUrl = `/uploads/${req.file.filename}`;
        validatedData.fileName = req.file.originalname;
      }

      const application = await storage.createApplication(validatedData);
      
      // In a real app, send email notification here using SendGrid/Nodemailer
      console.log(`[EMAIL NOTIFICATION] New application submitted: ${application.id} by ${application.fullName}`);
      console.log(`[EMAIL NOTIFICATION] Would send email to: ${application.email}`);
      
      res.status(201).json(application);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid input data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create application" });
    }
  });

  app.patch("/api/applications/:id/status", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = updateGrantApplicationStatusSchema.parse(req.body);
      
      const application = await storage.updateApplicationStatus(
        id,
        validatedData.status,
        validatedData.adminNotes,
        validatedData.disbursementAmount
      );

      // In a real app, send email notification to user about status change
      console.log(`[EMAIL NOTIFICATION] Application ${id} status updated to ${validatedData.status}`);
      console.log(`[EMAIL NOTIFICATION] Would send email to: ${application.email}`);
      console.log(`[EMAIL NOTIFICATION] Subject: Your Grant Application Status Update`);
      console.log(`[EMAIL NOTIFICATION] Message: Your application "${application.projectTitle}" is now ${validatedData.status}`);
      if (validatedData.disbursementAmount) {
        console.log(`[EMAIL NOTIFICATION] Disbursement amount: $${validatedData.disbursementAmount}`);
      }
      
      res.json(application);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid input data", errors: error.errors });
      }
      if (error.message === "Application not found") {
        return res.status(404).json({ message: "Application not found" });
      }
      res.status(500).json({ message: "Failed to update application status" });
    }
  });

  // User routes (admin only)
  app.get("/api/users", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      // Remove passwords from response
      const usersWithoutPasswords = users.map(({ password, ...user }) => user);
      res.json(usersWithoutPasswords);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // For Vercel deployment, WebSocket functionality would need to be handled separately
  // You might consider using an external service like Pusher for real-time chat
  console.log('[INFO] WebSocket server not initialized for Vercel deployment');
  
  // In a real production scenario for Vercel, you would implement:
  // 1. A separate real-time service (like Pusher)
  // 2. Or periodic API polling
  // 3. Or Server-Sent Events (SSE)
}