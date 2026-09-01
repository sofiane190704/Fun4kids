// Vercel serverless entry point: re-exports the existing Express app.
// vercel.json routes every request here — see server.js for the actual
// routes (static site + /api/contact + /api/inscription).
module.exports = require('../server');
