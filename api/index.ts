import type { VercelRequest, VercelResponse } from '@vercel/node';
import app from './src/index';

// Vercel API handler that wraps the Express app
const handler = (req: VercelRequest, res: VercelResponse) => {
  // Pass the request to the Express app
  app(req, res);
};

export default handler;