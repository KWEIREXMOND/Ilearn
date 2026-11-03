'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const os=require('node:os');const path=require('node:path');const fs=require('node:fs/promises');const {createClient}=require('@libsql/client');const {createServer}=require('../server');
function listen(server){return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)))}
function auth(base,endpoint,body){return fetch(base+'/api/auth/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify(body)})}
test('database-backed accounts and sessions work across independent server instances',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ilearn-db-')),url='file:'+path.join(dir,'db.sqlite');
  const db1=createClient({url}),db2=createClient({url}),s1=createServer({databaseClient:db1,apiKey:''}),s2=createServer({databaseClient:db2,apiKey:''});
  const a=await listen(s1),b=await listen(s2);
  try{
    const first=await auth(a,'register',{email:'db@example.com',password:'test-secure-password'});assert.equal(first.status,201);const cookie=first.headers.get('set-cookie').split(';')[0];
    const me=await fetch(b+'/api/auth/session',{headers:{Cookie:cookie}});assert.equal(me.status,200);assert.equal((await me.json()).user.email,'db@example.com');
    const login=await auth(b,'login',{email:'DB@example.com',password:'test-secure-password'});assert.equal(login.status,200);
    assert.equal((await auth(b,'register',{email:'db@example.com',password:'test-secure-password'})).status,409);
    const logout=await fetch(b+'/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json',Origin:b,Cookie:cookie},body:'{}'});assert.equal(logout.status,200);
    assert.equal((await fetch(a+'/api/auth/session',{headers:{Cookie:cookie}})).status,401);
  }finally{await new Promise(r=>s1.close(r));await new Promise(r=>s2.close(r));db1.close();db2.close();await fs.rm(dir,{recursive:true,force:true})}
});

test('accepts JSON already parsed by a serverless runtime and enforces its size limit', async()=>{
  const {readJson}=require('../auth');
  assert.deepEqual(await readJson({body:{email:'learner@example.com'}},100),{email:'learner@example.com'});
  await assert.rejects(readJson({body:{source:'x'.repeat(500)}},100),err=>err.status===413);
});

test('Vercel auth session function reaches the shared route handler', async()=>{
  const http=require('node:http');const handler=require('../api/auth/session');const server=http.createServer(handler),base=await listen(server);
  try {const res=await fetch(base+'/api/auth/session');assert.equal(res.status,401);assert.match((await res.json()).error,/sign in/i)}
  finally {await new Promise(resolve=>server.close(resolve))}
});
