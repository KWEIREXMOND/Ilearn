'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer, validateQuestions } = require('../server');

const input = { subject: 'Government', topic: 'Federal government', format: 'multiple-choice', difficulty: 'Medium', examStyle: 'WASSCE', count: 1, source: '' };
const question = { text: 'How is power distributed in a federal state?', options: ['Between levels of government', 'Only locally', 'Only centrally', 'To foreign governments'], answer: 0, explanation: 'Power is shared between national and regional governments.' };
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const cookies = new Map();
async function withServer(config, run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ilearn-auth-test-'));
  const server = createServer({ ...config, accountFile: path.join(dir, 'accounts.json') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const registration = await fetch(base + '/api/auth/register', { method:'POST', headers:{'Content-Type':'application/json', Origin:base}, body:JSON.stringify({ email:'test@example.com', password:'a-secure-test-password' }) });
    assert.equal(registration.status, 201);
    cookies.set(base, registration.headers.get('set-cookie').split(';')[0]);
    await run(base, path.join(dir, 'accounts.json'));
  } finally { cookies.delete(base); await new Promise(resolve => server.close(resolve)); await fs.rm(dir, { recursive:true, force:true }); }
}
function post(base, body = input, extra = {}) { return fetch(base + '/api/generate-questions', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin:base, Cookie:cookies.get(base), ...extra }, body: JSON.stringify(body) }); }

test('missing key fails gracefully without exposing configuration', async () => {
  await withServer({ apiKey: '' }, async base => {
    const response = await post(base);
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /not configured/);
  });
});

test('calls Gemini server-side and returns validated questions', async () => {
  let call;
  const fakeFetch = async (url, options) => {
    call = { url, options };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ questions: [question] }) }] } }] }) };
  };
  await withServer({ apiKey: 'private-test-key', fetchImpl: fakeFetch }, async base => {
    const response = await post(base, { ...input, source: 'Federal systems divide power.' });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).questions, [question]);
    assert.equal(call.options.headers['x-goog-api-key'], 'private-test-key');
    assert.match(call.url, /\/models\/gemini-3\.5-flash-lite:generateContent$/);
    const prompt = JSON.parse(call.options.body).contents[0].parts[0].text;
    assert.match(prompt, /Federal government/); assert.match(prompt, /Federal systems divide power/);
    assert.match(prompt, /not claim the questions are authentic/);
  });
});

test('reports actionable Gemini upstream errors without exposing upstream details', async () => {
  let status = 400;
  let details = [{ reason: 'API_KEY_INVALID' }];
  const fakeFetch = async () => ({ ok: false, status, json: async () => ({ error: { message: 'private-test-key secret upstream data', details } }) });
  await withServer({ apiKey: 'private-test-key', fetchImpl: fakeFetch }, async base => {
    for (const [code, detail, expected] of [
      [400, [{ reason: 'API_KEY_INVALID' }], /rejected the Gemini API key/],
      [400, [], /rejected the Gemini request/],
      [429, [], /quota or rate limit/],
      [403, [], /denied Gemini access/],
      [404, [], /model was not found/],
      [503, [], /try again later/],
    ]) {
      status = code; details = detail;
      const response = await post(base);
      assert.equal(response.status, 502);
      const body = await response.json();
      assert.match(body.error, expected);
      assert.doesNotMatch(JSON.stringify(body), /private-test-key|secret upstream data/);
    }
  });
});

test('rejects invalid inputs, cross-origin requests, and malformed model output', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ questions: [{ ...question, answer: 9 }] }) }] } }] }) });
  await withServer({ apiKey: 'test', fetchImpl: fakeFetch }, async base => {
    assert.equal((await post(base, { ...input, count: 11 })).status, 400);
    assert.equal((await post(base, input, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await post(base)).status, 502);
    assert.equal((await fetch(base + '/server.js')).status, 404);
  });
});

test('rejects duplicate questions and invalid true/false options', () => {
  assert.throws(() => validateQuestions([question, { ...question, text: question.text.toUpperCase() }], { ...input, count: 2 }), /Duplicate/);
  assert.throws(() => validateQuestions([{ ...question, options: ['Yes', 'No'] }], { ...input, format: 'true-false' }), /true\/false/);
});

test('generates and validates sequential lesson steps', async () => {
  const steps = [
    { title: 'Power sharing', content: 'A federal system shares power across levels.', question },
    { title: 'Constitution', content: 'A constitution defines these powers.', question: { ...question, text: 'What defines powers in a federal system?' } },
  ];
  let prompt;
  const fakeFetch = async (_url, options) => {
    prompt = JSON.parse(options.body).contents[0].parts[0].text;
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ steps }) }] } }] }) };
  };
  await withServer({ apiKey: 'test', fetchImpl: fakeFetch }, async base => {
    const response = await fetch(base + '/api/generate-lesson', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin:base, Cookie:cookies.get(base) }, body: JSON.stringify({ subject: 'Government', topic: 'Federal government', count: 2, source: 'A federal system divides powers.' }) });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).steps, steps);
    assert.match(prompt, /Federal government/); assert.match(prompt, /A federal system divides powers/);
  });
});

test('rejects incomplete and duplicate lesson checks', () => {
  const { validateLesson } = require('../server');
  const step = { title: 'First', content: 'A lesson.', question };
  assert.throws(() => validateLesson([step], { count: 2 }), /Incomplete/);
  assert.throws(() => validateLesson([step, step], { count: 2 }), /Duplicate/);
});

test('serves the local OCR worker, core and English language data', async () => {
  await withServer({ apiKey: '' }, async base => {
    for (const path of ['/vendor/tesseract.mjs', '/vendor/ocr/worker.min.js', '/vendor/ocr/core/tesseract-core-lstm.wasm.js', '/vendor/ocr/core/tesseract-core-simd-lstm.wasm.js', '/vendor/ocr/lang/eng.traineddata.gz']) {
      const response = await fetch(base + path); assert.equal(response.status, 200, path); await response.arrayBuffer();
    }
    assert.equal((await fetch(base + '/vendor/ocr/core/package.json')).status, 404);
  });
});

test('account sign-in, session, logout, and protected generation', async () => {
  await withServer({ apiKey: 'test' }, async (base, accountFile) => {
    const registerData = JSON.parse(await fs.readFile(accountFile, 'utf8'));
    assert.equal(registerData[0].email, 'test@example.com');
    assert.ok(registerData[0].passwordHash); assert.ok(!JSON.stringify(registerData).includes('a-secure-test-password'));
    const unauthorized = await fetch(base + '/api/generate-questions', { method:'POST', headers:{'Content-Type':'application/json', Origin:base}, body:JSON.stringify(input) });
    assert.equal(unauthorized.status, 401);
    const wrong = await fetch(base + '/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json', Origin:base}, body:JSON.stringify({email:'test@example.com',password:'incorrect-password'}) });
    assert.equal(wrong.status, 401);
    const login = await fetch(base + '/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json', Origin:base}, body:JSON.stringify({email:'TEST@example.com',password:'a-secure-test-password'}) });
    assert.equal(login.status, 200); const cookie=login.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
    const session = cookie.split(';')[0];
    assert.equal((await fetch(base + '/api/auth/session',{headers:{Cookie:session}})).status, 200);
    const crossOrigin = await fetch(base + '/api/auth/logout',{method:'POST', headers:{'Content-Type':'application/json',Origin:'https://evil.example', Cookie:session},body:'{}'});
    assert.equal(crossOrigin.status,403);
    const logout = await fetch(base + '/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:session},body:'{}'});
    assert.equal(logout.status,200);
    assert.equal((await fetch(base + '/api/auth/session',{headers:{Cookie:session}})).status,401);
  });
});

test('duplicate registration is serialized, and accounts persist across servers', async () => {
  await withServer({ apiKey:'' }, async (base, accountFile) => {
    const register = () => fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({email:'new@example.com',password:'another-secure-password'})});
    const results = await Promise.all([register(),register()]);
    assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
    const other=createServer({apiKey:'',accountFile,trustProxy:true});
    await new Promise(resolve=>other.listen(0,'127.0.0.1',resolve));
    try {
      const otherBase=`http://127.0.0.1:${other.address().port}`;
      const login=await fetch(otherBase+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:otherBase,'X-Forwarded-Proto':'https'},body:JSON.stringify({email:'new@example.com',password:'another-secure-password'})});
      assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/SameSite=None; Secure/);
    } finally {await new Promise(resolve=>other.close(resolve));}
  });
});

test('trusted preview proxy supports forwarded origin and partitioned secure cookies', async()=>{
  await withServer({apiKey:'',trustProxy:true},async base=>{
    const response=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://preview.example','X-Forwarded-Host':'preview.example','X-Forwarded-Proto':'https'},body:JSON.stringify({email:'proxy@example.com',password:'proxy-safe-password'})});
    assert.equal(response.status,201);assert.match(response.headers.get('set-cookie'),/SameSite=None; Secure; Partitioned/);
  });
});
