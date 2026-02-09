import { createServer } from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import path from "path";
import { storage } from "./storage.js";
import { registerUserSchema, loginSchema, insertGrantApplicationSchema, updateGrantApplicationStatusSchema } from "../shared/schema.js";

// Cloudinary configuration
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure Cloudinary storage for multer
const cloudinaryStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: "granthub-applications",
        allowed_formats: ["pdf", "doc", "docx"],
        resource_type: "auto",
    },
});

const upload = multer({
    storage: cloudinaryStorage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    }
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
    // Root route with API documentation
    app.get("/", (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>GrantHub API | Service Status</title>
                <style>
                    :root {
                        --primary: #4f46e5;
                        --bg: #0f172a;
                        --card: #1e293b;
                        --text: #f8fafc;
                        --accent: #818cf8;
                    }
                    body {
                        font-family: 'Inter', -apple-system, sans-serif;
                        background: var(--bg);
                        color: var(--text);
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        min-height: 100vh;
                        margin: 0;
                        padding: 20px;
                    }
                    .container {
                        max-width: 600px;
                        width: 100%;
                        background: var(--card);
                        padding: 40px;
                        border-radius: 24px;
                        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        backdrop-filter: blur(10px);
                    }
                    h1 { 
                        margin-top: 0; 
                        color: var(--accent);
                        font-size: 2.5rem;
                        letter-spacing: -0.025em;
                    }
                    .status {
                        display: inline-flex;
                        align-items: center;
                        background: rgba(34, 197, 94, 0.2);
                        color: #4ade80;
                        padding: 6px 12px;
                        border-radius: 99px;
                        font-size: 0.875rem;
                        font-weight: 600;
                        margin-bottom: 24px;
                    }
                    .status::before {
                        content: '';
                        width: 8px;
                        height: 8px;
                        background: #4ade80;
                        border-radius: 50%;
                        margin-right: 8px;
                        box-shadow: 0 0 10px #4ade80;
                    }
                    p { line-height: 1.6; color: #94a3b8; }
                    .endpoints {
                        margin-top: 32px;
                        display: grid;
                        gap: 16px;
                    }
                    .endpoint {
                        background: rgba(255, 255, 255, 0.05);
                        padding: 16px;
                        border-radius: 12px;
                        border: 1px solid rgba(255, 255, 255, 0.05);
                    }
                    .endpoint span {
                        font-weight: 700;
                        color: var(--accent);
                        margin-right: 8px;
                    }
                    code {
                        background: #000;
                        padding: 2px 6px;
                        border-radius: 4px;
                        font-size: 0.9em;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="status">System Online</div>
                    <h1>GrantHub API</h1>
                    <p>Welcome to the GrantHub backend. This service manages grant applications, user authentication, and real-time administrative communication.</p>
                    
                    <div class="endpoints">
                        <div class="endpoint">
                            <span>Auth:</span> <code>/api/auth/*</code>
                        </div>
                        <div class="endpoint">
                            <span>Applications:</span> <code>/api/applications/*</code>
                        </div>
                        <div class="endpoint">
                            <span>Users:</span> <code>/api/users</code>
                        </div>
                        <div class="endpoint">
                            <span>Real-time:</span> <code>/ws</code> (WebSocket)
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `);
    });

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

            // Handle file upload if present
            if (req.file) {
                // With Cloudinary, the file URL is in req.file.path
                validatedData.fileUrl = req.file.path;
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
            console.error('[API] Application submission error:', error);
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
    // Create HTTP server without WebSocket initially to avoid conflicts
    const httpServer = createServer(app);
    // Create WebSocket server
    const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
    // Extend Express Request type to include user
    const clients = new Map();
    // In-memory storage for messages (in a real app, use a database)
    const messages = [];
    wss.on('connection', (ws, req) => {
        console.log('[WS] New client connected');
        // Handle authentication
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message.toString());
                if (data.type === 'auth') {
                    // Verify JWT token
                    jwt.verify(data.token, JWT_SECRET, (err, decoded) => {
                        if (err) {
                            console.log('[WS] Authentication failed', err);
                            ws.send(JSON.stringify({ type: 'auth-error', message: 'Invalid token' }));
                            ws.close();
                            return;
                        }
                        // Add client to our map
                        clients.set(data.userId, { ws, userId: data.userId, role: decoded.role });
                        console.log(`[WS] User ${data.userId} authenticated as ${decoded.role}`);
                        // Send chat history to the user
                        // For user: send messages where they are the sender or receiver
                        // For admin: send all messages
                        const userMessages = messages.filter(msg => decoded.role === 'admin' ||
                            msg.userId === data.userId ||
                            msg.targetUserId === data.userId);
                        ws.send(JSON.stringify({
                            type: 'history',
                            messages: userMessages
                        }));
                    });
                }
                else if (data.type === 'send' && data.userId) {
                    // Handle message sending
                    const sender = clients.get(data.userId);
                    if (!sender) {
                        ws.send(JSON.stringify({ type: 'error', message: 'User not authenticated' }));
                        return;
                    }
                    // Create message object
                    const messageObj = {
                        id: Date.now().toString(),
                        userId: data.userId,
                        senderRole: data.senderRole,
                        message: data.message,
                        createdAt: new Date().toISOString(),
                        targetUserId: data.targetUserId
                    };
                    // Store message in memory (in a real app, this would go to a database)
                    messages.push(messageObj);
                    if (sender.role === 'admin' && data.targetUserId) {
                        // Admin sending to specific user
                        const targetClient = clients.get(data.targetUserId);
                        if (targetClient) {
                            // Send to target user
                            targetClient.ws.send(JSON.stringify({
                                type: 'message',
                                ...messageObj
                            }));
                            // Also send to admin to show in their chat
                            sender.ws.send(JSON.stringify({
                                type: 'message',
                                ...messageObj
                            }));
                        }
                        else {
                            // User not online, send to admin to show their message
                            sender.ws.send(JSON.stringify({
                                type: 'message',
                                ...messageObj
                            }));
                        }
                    }
                    else if (sender.role === 'user') {
                        // Find admin clients to send to
                        let adminFound = false;
                        for (const [id, client] of clients) {
                            if (client.role === 'admin') {
                                adminFound = true;
                                client.ws.send(JSON.stringify({
                                    type: 'message',
                                    ...messageObj
                                }));
                            }
                        }
                        // Send to sender too
                        sender.ws.send(JSON.stringify({
                            type: 'message',
                            ...messageObj
                        }));
                        // If no admin is online, we might want to store the message for later delivery
                        if (!adminFound) {
                            console.log('[WS] No admin online, message stored for later delivery');
                        }
                    }
                }
                else if (data.type === 'getHistory' && data.userId) {
                    // Send chat history for specific conversation between admin and user
                    if (data.targetUserId) {
                        const conversationMessages = messages.filter(msg => (msg.userId === data.userId && msg.targetUserId === data.targetUserId) ||
                            (msg.userId === data.targetUserId && msg.targetUserId === data.userId));
                        ws.send(JSON.stringify({
                            type: 'history',
                            messages: conversationMessages
                        }));
                    }
                }
            }
            catch (e) {
                console.error('[WS] Error processing message:', e);
            }
        });
        // Handle client disconnect
        ws.on('close', () => {
            console.log('[WS] Client disconnected');
            // Remove client from map
            for (const [id, client] of clients) {
                if (client.ws === ws) {
                    clients.delete(id);
                    break;
                }
            }
        });
        // Handle errors
        ws.on('error', (error) => {
            console.error('[WS] Connection error:', error);
        });
    });
    return httpServer;
}
