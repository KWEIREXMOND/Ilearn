'use strict';
// Each Vercel function forwards its request to the shared application handler.
const { createServer } = require('./server');
const server = createServer({ trustProxy:true });
module.exports = (req, res) => server.listeners('request')[0](req, res);
