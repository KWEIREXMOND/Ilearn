'use strict';
// Vercel invokes the same request handler as the local HTTP server.
const { createServer } = require('../server');
const server = createServer({ trustProxy:true });
module.exports = (req, res) => server.listeners('request')[0](req, res);
