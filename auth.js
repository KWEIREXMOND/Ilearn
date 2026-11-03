'use strict';
// Single-process local account store for the prototype; never expose this file as a static asset.
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const SESSION_MS = 12 * 60 * 60 * 1000;
const AUTH_WINDOW = 15 * 60 * 1000;

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}
function sameOrigin(req, trustProxy = false) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '') || !req.headers.origin) return false;
  try {
    const origin = new URL(req.headers.origin);
    const forwardedHost = trustProxy ? String(req.headers['x-forwarded-host'] || '').split(',')[0].trim() : '';
    const expectedHost = forwardedHost || req.headers.host;
    return ['https:', 'http:'].includes(origin.protocol) && origin.host === expectedHost;
  } catch { return false; }
}
async function readJson(req, maxBytes = 4096) {
  let raw;
  // Vercel may pre-parse the request body; local Node HTTP supplies a stream instead.
  if (req.body !== undefined) {
    if (Buffer.isBuffer(req.body)) raw = req.body.toString('utf8');
    else if (typeof req.body === 'string') raw = req.body;
    else raw = JSON.stringify(req.body);
    if (Buffer.byteLength(raw || '', 'utf8') > maxBytes) { const error = new Error('Request too large'); error.status = 413; throw error; }
  } else {
    let chunks = [], size = 0;
    for await (const chunk of req) { size += chunk.length; if (size <= maxBytes) chunks.push(chunk); }
    if (size > maxBytes) { const error = new Error('Request too large'); error.status = 413; throw error; }
    raw = Buffer.concat(chunks).toString('utf8');
  }
  return JSON.parse(raw);
}
function cookieValues(req) {
  return [...(req.headers.cookie || '').matchAll(/(?:^|;\s*)ilearn_session=([A-Za-z0-9_-]{43})(?=;|$)/g)].map(match => match[1]);
}
function secureRequest(req, trustProxy) {
  return !!req.socket.encrypted || (trustProxy && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
}
function createAuth({ accountFile, trustProxy = false } = {}) {
  accountFile ||= process.env.ILEARN_ACCOUNTS_FILE || path.join(__dirname, 'data', 'accounts.json');
  let accountsPromise; let queue = Promise.resolve();
  const sessions = new Map(), rates = new Map();
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  const load = () => accountsPromise ||= fs.readFile(accountFile, 'utf8').then(raw => { const data = JSON.parse(raw); if (!Array.isArray(data)) throw Error('Invalid account store'); return data; }).catch(err => { if (err.code === 'ENOENT') return []; throw err; });
  const publicUser = account => ({ id: account.id, email: account.email });
  async function writeAccounts(accounts) {
    await fs.mkdir(path.dirname(accountFile), { recursive: true, mode: 0o700 });
    const temp = `${accountFile}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    try { await fs.writeFile(temp, JSON.stringify(accounts), { mode: 0o600, flag: 'wx' }); await fs.rename(temp, accountFile); }
    finally { await fs.unlink(temp).catch(() => {}); }
  }
  function setCookie(req, res, token, maxAge) {
    const secure = secureRequest(req, trustProxy);
    res.setHeader('Set-Cookie', `ilearn_session=${token}; Path=/; HttpOnly; ${secure ? 'SameSite=None; Secure; Partitioned' : 'SameSite=Strict'}; Max-Age=${maxAge}`);
  }
  function getUser(req) {
    for (const token of cookieValues(req)) {
      const key = hash(token), session = sessions.get(key);
      if (!session) continue;
      if (session.expires <= Date.now()) { sessions.delete(key); continue; }
      return session.user;
    }
    return null;
  }
  function startSession(req, res, user) {
    const token = crypto.randomBytes(32).toString('base64url');
    for (const previous of cookieValues(req)) sessions.delete(hash(previous));
    sessions.set(hash(token), { user, expires: Date.now() + SESSION_MS });
    setCookie(req, res, token, SESSION_MS / 1000);
  }
  function rateLimited(req, email) {
    const now = Date.now();
    for (const [key, value] of rates) if (now - value.start >= AUTH_WINDOW) rates.delete(key);
    for (const [key, limit] of [[`ip:${req.socket.remoteAddress || ''}`, 20], [`email:${email}`, 10]]) {
      const entry = rates.get(key) || { start: now, count: 0 };
      if (entry.count >= limit) return true;
      entry.count++; rates.set(key, entry);
    }
    return false;
  }
  async function handle(req, res, pathname) {
    if (!pathname.startsWith('/api/auth/')) return false;
    if (pathname === '/api/auth/session' && req.method === 'GET') {
      const user = getUser(req); json(res, user ? 200 : 401, user ? { user } : { error: 'Please sign in.' }); return true;
    }
    if (!['/api/auth/register','/api/auth/login','/api/auth/logout'].includes(pathname) || req.method !== 'POST') { json(res, 404, { error:'Not found.' }); return true; }
    if (!sameOrigin(req, trustProxy)) { json(res, 403, { error:'Request must be sent from this application.' }); return true; }
    if (pathname === '/api/auth/logout') {
      for (const token of cookieValues(req)) sessions.delete(hash(token));
      setCookie(req, res, '', 0); json(res, 200, { ok:true }); return true;
    }
    let body;
    try { body = await readJson(req); } catch { json(res, 400, { error:'Invalid request.' }); return true; }
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || Buffer.byteLength(password, 'utf8') > 256 || password.length < 10 || password.length > 128) {
      json(res, 400, { error:'Enter a valid email and a password between 10 and 128 characters.' }); return true;
    }
    if (rateLimited(req, email)) { json(res, 429, { error:'Too many attempts. Please try again later.' }); return true; }
    try {
      if (pathname === '/api/auth/register') {
        // Serialize registration so concurrent requests cannot create duplicate emails.
        const registration = queue.then(async () => {
          const accounts = await load();
          if (accounts.some(a => a.email === email)) return null;
          const salt = crypto.randomBytes(16).toString('hex');
          const key = await scrypt(password, salt, 64);
          const account = { id:crypto.randomUUID(), email, salt, passwordHash:key.toString('hex') };
          await writeAccounts([...accounts, account]); accounts.push(account); return account;
        });
        queue = registration.catch(() => {});
        const account = await registration;
        if (!account) { json(res, 409, { error:'An account with that email already exists. Please sign in.' }); return true; }
        const user = publicUser(account); startSession(req, res, user); json(res, 201, { user }); return true;
      }
      const accounts = await load(), account = accounts.find(a => a.email === email);
      const salt = account?.salt || '00000000000000000000000000000000';
      const key = await scrypt(password, salt, 64);
      const stored = account ? Buffer.from(account.passwordHash, 'hex') : Buffer.alloc(64);
      if (!account || stored.length !== key.length || !crypto.timingSafeEqual(key, stored)) { json(res, 401, { error:'Incorrect email or password.' }); return true; }
      const user = publicUser(account); startSession(req, res, user); json(res, 200, { user }); return true;
    } catch { json(res, 503, { error:'Account service is unavailable. Please try again.' }); return true; }
  }
  return { handle, getUser };
}
module.exports = { createAuth, sameOrigin, cookieValues, secureRequest, readJson, json };
