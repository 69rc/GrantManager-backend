import express from "express";
import { registerRoutes } from "./routes";
import { log } from "./vite";
const app = express();
app.use(express.json({
    verify: (req, _res, buf) => {
        req.rawBody = buf;
    }
}));
app.use(express.urlencoded({ extended: false }));
// Serve uploaded files
app.use('/uploads', express.static('uploads'));
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
// Register routes
registerRoutes(app);
app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
});
// Only start the server if this file is run directly (not imported)
if (require.main === module) {
    const port = parseInt(process.env.PORT || '5000', 10);
    app.listen(port, () => {
        log(`API serving on port ${port}`);
    });
}
// Export the app for Vercel serverless functions
export default app;
