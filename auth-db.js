'use strict';
// Serverless-compatible account and session storage. Every row is stored in the configured libSQL database.
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { createClient } = require('@libsql/client');
const { sameOrigin, cookieValues, secureRequest, readJson, json } = require('./auth');
const scrypt = promisify(crypto.scrypt);
const SESSION_MS = 12 * 60 * 60 * 1000;
const AUTH_WINDOW = 15 * 60 * 1000;

function createDbAuth({ url, authToken, trustProxy = false, client } = {}) {
  const db = client || createClient({ url, authToken });
  let ready;
  const init = () => ready ||= Promise.all([
    db.execute('CREATE TABLE IF NOT EXISTS ilearn_users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL)'),
    db.execute('CREATE TABLE IF NOT EXISTS ilearn_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL)'),
    db.execute('CREATE TABLE IF NOT EXISTS ilearn_rates (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)'),
  ]).catch(err => { ready = null; throw err; });
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  const clientIp = req => trustProxy ? String(req.headers['x-real-ip'] || req.socket.remoteAddress || '').slice(0, 128) : (req.socket.remoteAddress || '');
  async function rate(key, limit, windowMs) {
    await init(); const now = Date.now();
    const result = await db.execute({ sql: `INSERT INTO ilearn_rates (key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<=? THEN 1 ELSE count+1 END, expires=CASE WHEN expires<=? THEN ? ELSE expires END RETURNING count`, args:[hash(key), now+windowMs, now, now, now+windowMs] });
    return Number(result.rows[0].count) <= limit;
  }
  function setCookie(req, res, token, maxAge) {
    const secure = secureRequest(req, trustProxy);
    res.setHeader('Set-Cookie', `ilearn_session=${token}; Path=/; HttpOnly; ${secure ? 'SameSite=None; Secure; Partitioned' : 'SameSite=Strict'}; Max-Age=${maxAge}`);
  }
  async function getUser(req) {
    const tokens = cookieValues(req); if (!tokens.length) return null;
    await init();
    for (const token of tokens) {
      const result = await db.execute({ sql:'SELECT u.id, u.email FROM ilearn_sessions s JOIN ilearn_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?', args:[hash(token), Date.now()] });
      if (result.rows.length) return { id:result.rows[0].id, email:result.rows[0].email };
    }
    return null;
  }
  async function startSession(req, res, account) {
    const token = crypto.randomBytes(32).toString('base64url');
    await init();
    for (const old of cookieValues(req)) await db.execute({sql:'DELETE FROM ilearn_sessions WHERE token_hash=?',args:[hash(old)]});
    await db.execute({sql:'INSERT INTO ilearn_sessions (token_hash,user_id,expires) VALUES (?,?,?)',args:[hash(token),account.id,Date.now()+SESSION_MS]});
    setCookie(req,res,token,SESSION_MS/1000);
  }
  async function handle(req,res,pathname) {
    if (!pathname.startsWith('/api/auth/')) return false;
    try {
      if (pathname === '/api/auth/session' && req.method === 'GET') {
        const user=await getUser(req); json(res,user?200:401,user?{user}:{error:'Please sign in.'}); return true;
      }
      if (!['/api/auth/register','/api/auth/login','/api/auth/logout'].includes(pathname) || req.method !== 'POST') {json(res,404,{error:'Not found.'});return true;}
      if (!sameOrigin(req,trustProxy)) {json(res,403,{error:'Request must be sent from this application.'});return true;}
      if (pathname === '/api/auth/logout') {
        await init(); for(const token of cookieValues(req)) await db.execute({sql:'DELETE FROM ilearn_sessions WHERE token_hash=?',args:[hash(token)]});
        setCookie(req,res,'',0);json(res,200,{ok:true});return true;
      }
      let body;try{body=await readJson(req)}catch{json(res,400,{error:'Invalid request.'});return true}
      const email=typeof body?.email==='string'?body.email.trim().toLowerCase():'';
      const password=typeof body?.password==='string'?body.password:'';
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||Buffer.byteLength(password,'utf8')>256||password.length<10||password.length>128){json(res,400,{error:'Enter a valid email and a password between 10 and 128 characters.'});return true}
      if (!await rate('auth-ip:'+clientIp(req),20,AUTH_WINDOW) || !await rate('auth-email:'+email,10,AUTH_WINDOW)) {json(res,429,{error:'Too many attempts. Please try again later.'});return true}
      if(pathname==='/api/auth/register') {
        const salt=crypto.randomBytes(16).toString('hex'), passwordHash=(await scrypt(password,salt,64)).toString('hex');
        const account={id:crypto.randomUUID(),email};
        try {await db.execute({sql:'INSERT INTO ilearn_users (id,email,salt,password_hash) VALUES (?,?,?,?)',args:[account.id,email,salt,passwordHash]})}
        catch(err){if(String(err.message).toLowerCase().includes('unique')){json(res,409,{error:'An account with that email already exists. Please sign in.'});return true}throw err}
        await startSession(req,res,account);json(res,201,{user:account});return true;
      }
      const found=await db.execute({sql:'SELECT id,email,salt,password_hash FROM ilearn_users WHERE email=?',args:[email]}), account=found.rows[0];
      const key=await scrypt(password,account?.salt||'00000000000000000000000000000000',64), stored=account?Buffer.from(account.password_hash,'hex'):Buffer.alloc(64);
      if(!account||stored.length!==key.length||!crypto.timingSafeEqual(key,stored)){json(res,401,{error:'Incorrect email or password.'});return true}
      const user={id:account.id,email:account.email};await startSession(req,res,user);json(res,200,{user});return true;
    } catch {json(res,503,{error:'Account database is unavailable. Please try again later.'});return true}
  }
  async function allowGeneration(req, user) { return rate('generation:'+user.id,10,60*60*1000); }
  return {handle,getUser,allowGeneration};
}
module.exports={createDbAuth};
