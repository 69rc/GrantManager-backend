import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
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
        }
        else {
            cb(new Error("Only PDF and DOC files are allowed"));
        }
    },
});
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";
// Middleware to check admin role
function requireAdmin(req, res, next) {
    // In this version without JWT authentication, 
    // you might authenticate through a different mechanism
    // For now, assuming req.user is set by some other middleware
    // Or you could implement a different authentication method
    if (!req.user || req.user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
    }
    next();
}
export async function registerRoutes(app) {
    // Enable CORS for specific frontend origin
    app.use(cors({
        origin: 'https://grant-manager-frontend-ekb1.vercel.app',
        credentials: true
    }));
    // Authentication routes
    app.post("/api/auth/register", async (req, res) => {
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
            const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
            // Remove password from response
            const { password, ...userWithoutPassword } = user;
            res.status(201).json({ user: userWithoutPassword, token });
        }
        catch (error) {
            if (error.name === "ZodError") {
                return res.status(400).json({ message: "Invalid input data", errors: error.errors });
            }
            res.status(500).json({ message: "Registration failed" });
        }
    });
    app.post("/api/auth/login", async (req, res) => {
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
            const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
            // Remove password from response
            const { password, ...userWithoutPassword } = user;
            res.json({ user: userWithoutPassword, token });
        }
        catch (error) {
            if (error.name === "ZodError") {
                return res.status(400).json({ message: "Invalid input data", errors: error.errors });
            }
            res.status(500).json({ message: "Login failed" });
        }
    });
    // Grant application routes
    app.get("/api/applications", requireAdmin, async (req, res) => {
        try {
            const applications = await storage.getAllApplications();
            res.json(applications);
        }
        catch (error) {
            res.status(500).json({ message: "Failed to fetch applications" });
        }
    });
    app.get("/api/applications/user/:userId", async (req, res) => {
        try {
            const { userId } = req.params;
            // In this version without JWT authentication, 
            // you would need to implement a different way to verify user identity
            // For now, this check is disabled since authentication is removed
            // You may want to implement session-based auth or another method
            const applications = await storage.getApplicationsByUser(userId);
            res.json(applications);
        }
        catch (error) {
            res.status(500).json({ message: "Failed to fetch applications" });
        }
    });
    app.post("/api/applications", upload.single("file"), async (req, res) => {
        try {
            // Parse JSON data from multipart form
            const applicationData = JSON.parse(req.body.data || "{}");
            const validatedData = insertGrantApplicationSchema.parse(applicationData);
            // In this version without JWT authentication,
            // you would need a different way to verify user identity
            // For now, this check is disabled since authentication is removed
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
        }
        catch (error) {
            if (error.name === "ZodError") {
                return res.status(400).json({ message: "Invalid input data", errors: error.errors });
            }
            res.status(500).json({ message: "Failed to create application" });
        }
    });
    app.patch("/api/applications/:id/status", requireAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            const validatedData = updateGrantApplicationStatusSchema.parse(req.body);
            const application = await storage.updateApplicationStatus(id, validatedData.status, validatedData.adminNotes, validatedData.disbursementAmount);
            // In a real app, send email notification to user about status change
            console.log(`[EMAIL NOTIFICATION] Application ${id} status updated to ${validatedData.status}`);
            console.log(`[EMAIL NOTIFICATION] Would send email to: ${application.email}`);
            console.log(`[EMAIL NOTIFICATION] Subject: Your Grant Application Status Update`);
            console.log(`[EMAIL NOTIFICATION] Message: Your application "${application.projectTitle}" is now ${validatedData.status}`);
            if (validatedData.disbursementAmount) {
                console.log(`[EMAIL NOTIFICATION] Disbursement amount: $${validatedData.disbursementAmount}`);
            }
            res.json(application);
        }
        catch (error) {
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
    app.get("/api/users", requireAdmin, async (req, res) => {
        try {
            const users = await storage.getAllUsers();
            // Remove passwords from response
            const usersWithoutPasswords = users.map(({ password, ...user }) => user);
            res.json(usersWithoutPasswords);
        }
        catch (error) {
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
