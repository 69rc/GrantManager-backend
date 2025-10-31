import { type Express } from "express";
import { type Server } from "http";

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

// In the separated backend, we don't need Vite setup functions
// since the frontend will run independently
export async function setupVite(app: Express, server: Server) {
  // No Vite integration in the separated backend
  console.log("Vite integration disabled in separated backend");
}

export function serveStatic(app: Express) {
  // No static file serving in the separated backend
  console.log("Static file serving disabled in separated backend");
}
