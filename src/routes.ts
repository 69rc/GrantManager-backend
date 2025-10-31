import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
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
function authenticateToken(req: Request, res: Response, next: NextFunction) {
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
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Apply general rate limiting to all API routes
  app.use("/api", apiLimiter);

  // Authentication routes
  app.post("/api/auth/register", authLimiter, async (req, res) => {
    try {
      // Use public registration schema that omits role field
      const validatedData = registerUserSchema.parse(req.body);
      
      // Check if user already exists
      const existingUser = await storage.getUserByEmail((validatedData as any).email);
      if (existingUser) {
        return res.status(400).json({ message: "Email already registered" });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash((validatedData as any).password, 10);
      
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
      if (req.user!.role !== "admin" && req.user!.id !== userId) {
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
      if (req.user!.role !== "admin" && (validatedData as any).userId !== req.user!.id) {
        return res.status(403).json({ message: "Cannot create application for another user" });
      }

      // Handle file upload if present
      if (req.file) {
        (validatedData as any).fileUrl = `/uploads/${req.file.filename}`;
        (validatedData as any).fileName = req.file.originalname;
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

  // Create HTTP server without WebSocket initially to avoid conflicts
  const httpServer = createServer(app);

  // Create WebSocket server
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  
  // Store connected clients
  interface Client {
    ws: WebSocket;
    userId: string;
    role: string;
  }
  
  // Extend Express Request type to include user

  
  const clients: Map<string, Client> = new Map();
  
  // In-memory storage for messages (in a real app, use a database)
  const messages: Array<{
    id: string;
    userId: string;
    senderRole: string;
    message: string;
    createdAt: string;
    targetUserId?: string;
  }> = [];
  
  wss.on('connection', (ws: WebSocket, req) => {
    console.log('[WS] New client connected');
    
    // Handle authentication
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        if (data.type === 'auth') {
          // Verify JWT token
          jwt.verify(data.token, JWT_SECRET, (err: any, decoded: any) => {
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
            const userMessages = messages.filter(msg => 
              decoded.role === 'admin' || 
              msg.userId === data.userId || 
              msg.targetUserId === data.userId
            );
            
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
            } else {
              // User not online, send to admin to show their message
              sender.ws.send(JSON.stringify({ 
                type: 'message', 
                ...messageObj 
              }));
            }
          } else if (sender.role === 'user') {
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
            const conversationMessages = messages.filter(msg => 
              (msg.userId === data.userId && msg.targetUserId === data.targetUserId) ||
              (msg.userId === data.targetUserId && msg.targetUserId === data.userId)
            );
            
            ws.send(JSON.stringify({ 
              type: 'history', 
              messages: conversationMessages 
            }));
          }
        }
      } catch (e) {
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
