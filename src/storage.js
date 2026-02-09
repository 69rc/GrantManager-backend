import bcrypt from "bcryptjs";
import { db } from "./db-vercel.js";
import { users, grantApplications, chatMessages } from "../shared/schema.js";
import { eq, desc, asc } from "drizzle-orm";
export class DatabaseStorage {
    constructor() {
        // Initialize database storage with seed data if needed
        this.seedData();
    }
    async seedData() {
        // Check if admin user already exists
        const existingAdmin = await db.select().from(users).where(eq(users.email, "admin@granthub.com")).limit(1);
        if (existingAdmin.length === 0) {
            // Create admin user with real bcrypt hash
            const admin = {
                email: "admin@granthub.com",
                password: await bcrypt.hash("admin123", 10), // Real bcrypt hash for "admin123"
                fullName: "Admin User",
                phoneNumber: "+1 234 567 8900",
                role: "admin",
            };
            // @ts-ignore - Type resolution issue with Drizzle schema
            await db.insert(users).values(admin).returning();
        }
        // Check if demo user already exists
        const existingDemoUser = await db.select().from(users).where(eq(users.email, "demo@example.com")).limit(1);
        if (existingDemoUser.length === 0) {
            // Create demo user with real bcrypt hash
            const demoUser = {
                email: "demo@example.com",
                password: await bcrypt.hash("password", 10), // Real bcrypt hash for "password"
                fullName: "Demo User",
                phoneNumber: "+1 555 123 4567",
                role: "user",
            };
            const result = await db.insert(users).values(demoUser).returning();
            const userId = result[0].id;
            // Create sample applications for the demo user with explicit typing
            const applicationsToInsert = [
                {
                    userId: userId,
                    fullName: "Demo User",
                    email: "demo@example.com",
                    phoneNumber: "+1 555 123 4567",
                    address: "123 Main St, San Francisco, CA 94102",
                    projectTitle: "Community Education Center",
                    projectDescription: "Building a community center to provide free educational resources and tutoring for underprivileged children in our neighborhood.",
                    grantType: "education",
                    requestedAmount: 15000,
                    fileUrl: "",
                    fileName: "",
                },
                {
                    userId: userId,
                    fullName: "Demo User",
                    email: "demo@example.com",
                    phoneNumber: "+1 555 123 4567",
                    address: "123 Main St, San Francisco, CA 94102",
                    projectTitle: "Small Business Expansion",
                    projectDescription: "Expanding my bakery business to include a second location and hire 5 new employees.",
                    grantType: "business",
                    requestedAmount: 30000,
                    fileUrl: "",
                    fileName: "",
                }
            ];
            // @ts-ignore - Type resolution issue with Drizzle schema
            await db.insert(grantApplications).values(applicationsToInsert);
        }
    }
    // User operations
    async getUser(id) {
        const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
        return result[0];
    }
    async getUserByEmail(email) {
        const result = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
        return result[0];
    }
    async createUser(insertUser) {
        // Ensure email is stored in lowercase
        const userToInsert = {
            email: insertUser.email.toLowerCase(),
            password: insertUser.password,
            fullName: insertUser.fullName,
            phoneNumber: insertUser.phoneNumber,
            role: insertUser.role,
        };
        const result = await db.insert(users).values(userToInsert).returning();
        if (result.length > 0) {
            return result[0];
        }
        else {
            throw new Error("Failed to create user");
        }
    }
    async getAllUsers() {
        return await db.select().from(users).orderBy(asc(users.createdAt));
    }
    // Grant application operations
    async getApplication(id) {
        const result = await db.select().from(grantApplications).where(eq(grantApplications.id, id)).limit(1);
        return result[0];
    }
    async getApplicationsByUser(userId) {
        return await db.select()
            .from(grantApplications)
            .where(eq(grantApplications.userId, userId))
            .orderBy(desc(grantApplications.createdAt));
    }
    async getAllApplications() {
        return await db.select()
            .from(grantApplications)
            .orderBy(desc(grantApplications.createdAt));
    }
    async createApplication(insertApplication) {
        const applicationToInsert = {
            userId: insertApplication.userId,
            fullName: insertApplication.fullName,
            email: insertApplication.email,
            phoneNumber: insertApplication.phoneNumber,
            address: insertApplication.address,
            projectTitle: insertApplication.projectTitle,
            projectDescription: insertApplication.projectDescription,
            grantType: insertApplication.grantType,
            requestedAmount: insertApplication.requestedAmount,
            fileUrl: insertApplication.fileUrl || "",
            fileName: insertApplication.fileName || "",
            status: "pending", // Default status for new applications
            adminNotes: "", // Default admin notes
            disbursementAmount: insertApplication.disbursementAmount || null,
        };
        const result = await db.insert(grantApplications).values(applicationToInsert).returning();
        if (result.length > 0) {
            return result[0];
        }
        else {
            throw new Error("Failed to create application");
        }
    }
    async updateApplicationStatus(id, status, adminNotes, disbursementAmount) {
        const updateData = {
            status,
            adminNotes: adminNotes || "",
            updatedAt: new Date(),
        };
        // Only add disbursementAmount if it's provided
        if (disbursementAmount !== undefined) {
            updateData.disbursementAmount = disbursementAmount;
        }
        const result = await db
            .update(grantApplications)
            .set(updateData)
            .where(eq(grantApplications.id, id))
            .returning();
        if (result.length === 0) {
            throw new Error("Application not found");
        }
        return result[0];
    }
    // Chat message operations
    async getChatMessagesByUser(userId) {
        return await db.select()
            .from(chatMessages)
            .where(eq(chatMessages.userId, userId))
            .orderBy(asc(chatMessages.createdAt));
    }
    async getAllChatMessages() {
        return await db.select()
            .from(chatMessages)
            .orderBy(asc(chatMessages.createdAt));
    }
    async createChatMessage(insertMessage) {
        const messageToInsert = {
            userId: insertMessage.userId,
            senderRole: insertMessage.senderRole,
            message: insertMessage.message,
        };
        const result = await db.insert(chatMessages).values(messageToInsert).returning();
        return result[0];
    }
}
export const storage = new DatabaseStorage();
