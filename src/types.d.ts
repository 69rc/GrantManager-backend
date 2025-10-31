import type { User } from "../shared/schema";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: string;
      };
      file?: {
        filename: string;
        originalname: string;
      };
    }
  }
}

export {};