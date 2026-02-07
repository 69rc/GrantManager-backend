import type { VercelRequest, VercelResponse } from '@vercel/node';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { registerRoutes } from '../routes';
import { log } from '../vite';

// Create an Express app
const app = express();

// Middleware setup (same as in your original index.ts)
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Serve uploaded files
app.use('/uploads', express.static('uploads'));

// Logging middleware (same as in your original index.ts)
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson: any, ...args: any[]) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

// Register all routes
registerRoutes(app);

// Create an HTTP server
const httpServer = createServer(app);

// Create a Socket.IO server
const io = new Server(httpServer, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? process.env.FRONTEND_URL || 'https://grant-manager-frontend-ekb1.vercel.app'
      : [process.env.LOCALHOST_URL || 'http://localhost:3000', 'http://localhost:5173'],
    credentials: true
  }
});

// Handle Socket.IO connections
io.on('connection', (socket) => {
  console.log('New client connected');
  
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Convert Express app to a handler that Vercel can use
const handler = (req: VercelRequest, res: VercelResponse) => {
  // Pass the request to the Express app
  app(req, res);
};

export default handler;