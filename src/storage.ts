import { type User, type InsertUser, type GrantApplication, type InsertGrantApplication, type ChatMessage, type InsertChatMessage } from "@shared/schema";
import bcrypt from "bcryptjs";
import { db } from "./db-vercel";
import { users, grantApplications, chatMessages } from "@shared/schema";
import { eq, and, desc, asc } from "drizzle-orm";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;

  // Grant application operations
  getApplication(id: string): Promise<GrantApplication | undefined>;
  getApplicationsByUser(userId: string): Promise<GrantApplication[]>;
  getAllApplications(): Promise<GrantApplication[]>;
  createApplication(application: InsertGrantApplication): Promise<GrantApplication>;
  updateApplicationStatus(id: string, status: string, adminNotes?: string, disbursementAmount?: number): Promise<GrantApplication>;

  // Chat message operations
  getChatMessagesByUser(userId: string): Promise<ChatMessage[]>;
  getAllChatMessages(): Promise<ChatMessage[]>;
  createChatMessage(message: InsertChatMessage): Promise<ChatMessage>;
}

export class DatabaseStorage implements IStorage {
  constructor() {
    // Initialize database storage with seed data if needed
    this.seedData();
  }

  private async seedData() {
    // Check if admin user already exists
    const existingAdmin = await db.select().from(users).where(eq(users.email, "admin@granthub.com")).limit(1);
    if (existingAdmin.length === 0) {
      // Create admin user with real bcrypt hash
      const admin: InsertUser = {
        email: "admin@granthub.com",
        password: await bcrypt.hash("admin123", 10), // Real bcrypt hash for "admin123"
        fullName: "Admin User",
        phoneNumber: "+1 234 567 8900",
        role: "admin",
      };

      await db.insert(users).values(admin);
    }

    // Check if demo user already exists
    const existingDemoUser = await db.select().from(users).where(eq(users.email, "demo@example.com")).limit(1);
    if (existingDemoUser.length === 0) {
      // Create demo user with real bcrypt hash
      const demoUser: InsertUser = {
        email: "demo@example.com",
        password: await bcrypt.hash("password", 10), // Real bcrypt hash for "password"
        fullName: "Demo User",
        phoneNumber: "+1 555 123 4567",
        role: "user",
      };

      const result = await db.insert(users).values(demoUser).returning();
      const userId = result[0].id;

      // Create sample applications for the demo user
      await db.insert(grantApplications).values([
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
          status: "under_review",
          adminNotes: "",
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
          status: "approved",
          adminNotes: "Great business plan with clear growth strategy. Approved for full amount.",
        }
      ]);
    }
  }

  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0];
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    return result[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    // Ensure email is stored in lowercase
    const userToInsert = {
      ...insertUser,
      email: insertUser.email.toLowerCase()
    };
    
    const result = await db.insert(users).values(userToInsert).returning();
    return result[0];
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(asc(users.createdAt));
  }

  // Grant application operations
  async getApplication(id: string): Promise<GrantApplication | undefined> {
    const result = await db.select().from(grantApplications).where(eq(grantApplications.id, id)).limit(1);
    return result[0];
  }

  async getApplicationsByUser(userId: string): Promise<GrantApplication[]> {
    return await db.select()
      .from(grantApplications)
      .where(eq(grantApplications.userId, userId))
      .orderBy(desc(grantApplications.createdAt));
  }

  async getAllApplications(): Promise<GrantApplication[]> {
    return await db.select()
      .from(grantApplications)
      .orderBy(desc(grantApplications.createdAt));
  }

  async createApplication(insertApplication: InsertGrantApplication): Promise<GrantApplication> {
    const result = await db.insert(grantApplications).values({
      ...insertApplication,
      status: "pending",
      adminNotes: "",
    }).returning();
    return result[0];
  }

  async updateApplicationStatus(id: string, status: string, adminNotes?: string, disbursementAmount?: number): Promise<GrantApplication> {
    const updateData: any = {
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
  async getChatMessagesByUser(userId: string): Promise<ChatMessage[]> {
    return await db.select()
      .from(chatMessages)
      .where(eq(chatMessages.userId, userId))
      .orderBy(asc(chatMessages.createdAt));
  }

  async getAllChatMessages(): Promise<ChatMessage[]> {
    return await db.select()
      .from(chatMessages)
      .orderBy(asc(chatMessages.createdAt));
  }

  async createChatMessage(insertMessage: InsertChatMessage): Promise<ChatMessage> {
    const result = await db.insert(chatMessages).values(insertMessage).returning();
    return result[0];
  }
}

export const storage = new DatabaseStorage();
