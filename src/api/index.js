import app from '../index';
// Vercel API handler that wraps the Express app
const handler = (req, res) => {
    // Pass the request to the Express app
    app(req, res);
};
export default handler;
