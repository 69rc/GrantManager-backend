import express from "express";
import { registerRoutes } from "./src/routes.js";
import { fileURLToPath } from 'url';
import { initStorage } from "./src/storage.js";

export function log(message, source = "express") {

    const formattedTime = new Date().toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
    });
    console.log(`${formattedTime} [${source}] ${message}`);
}

const app = express();
app.use(express.json({
    verify: (req, _res, buf) => {
        req.rawBody = buf;
    }
}));
app.use(express.urlencoded({ extended: false }));
// Local uploads are disabled for Cloudinary/Vercel

app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse = undefined;
    const originalResJson = res.json;
    res.json = function (bodyJson) {
        capturedJsonResponse = bodyJson;
        return originalResJson.call(res, bodyJson);
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
// Initialize storage and seed data
initStorage().catch(err => {
    log(`Storage initialization failed: ${err.message}`, "error");
});

// Register routes
registerRoutes(app);

app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
});

// Check if this file is the entry point
const isMain = process.argv[1] && (fileURLToPath(import.meta.url) === process.argv[1]);

if (isMain || process.env.NODE_ENV === "development") {
    const port = parseInt(process.env.PORT || '5001', 10);
    app.listen(port, () => {
        log(`API serving on port ${port}`);
    });
}

// Export the app for Vercel serverless functions
export default app;
