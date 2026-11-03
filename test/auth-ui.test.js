'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
function waitFor(check) { return new Promise((resolve,reject)=>{let n=0;const id=setInterval(()=>{if(check()){clearInterval(id);resolve()}else if(++n>100){clearInterval(id);reject(Error('Timed out'))}},10)}); }
function click(w, s) { const e=w.document.querySelector(s);assert.ok(e,s);e.click(); }
function submit(w,s){w.document.querySelector(s).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));}
function set(w,n,v){w.document.querySelector(`[name="${n}"]`).value=v;}
test('login, logout and per-account browser workspaces', async()=>{
  const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{url:'http://localhost:8000',runScripts:'outside-only'}),w=dom.window;
  w.indexedDB=new IDBFactory();w.confirm=()=>true;w.scrollTo=()=>{};
  let signedIn=null;
  w.fetch=async(url,opts={})=>{
    if(url==='/api/auth/session')return signedIn ? {ok:true,status:200,json:async()=>({user:signedIn})} : {ok:false,status:401,json:async()=>({})};
    if(url==='/api/auth/logout'){signedIn=null;return {ok:true,status:200,json:async()=>({})};}
    const {email,password}=JSON.parse(opts.body);
    if(password!=='correct-password')return {ok:false,status:401,json:async()=>({error:'Incorrect email or password.'})};
    signedIn={id:email.startsWith('first')?'first':'second',email};return {ok:true,status:200,json:async()=>({user:signedIn})};
  };
  w.eval(fs.readFileSync('topic.js','utf8')+'\n'+fs.readFileSync('auth-ui.js','utf8')+'\n'+fs.readFileSync('app.js','utf8'));
  await waitFor(()=>w.document.querySelector('#auth-form'));
  set(w,'email','first@example.com');set(w,'password','wrong-password');submit(w,'#auth-form');await waitFor(()=>!w.document.querySelector('#auth-error').hidden);assert.match(w.document.querySelector('#auth-error').textContent,/Incorrect/);
  set(w,'password','correct-password');submit(w,'#auth-form');await waitFor(()=>w.document.querySelector('[data-action="add-subject"]'));
  click(w,'[data-action="add-subject"]');set(w,'name','Private subject');submit(w,'#modal-form');
  assert.ok(w.localStorage.getItem('ilearn-data-v1:first').includes('Private subject'));
  const logout=w.document.querySelector('.topbar [data-action="sign-out"]');assert.ok(logout);assert.equal(logout.textContent.trim(),'Log out');
  click(w,'.topbar [data-action="sign-out"]');await waitFor(()=>w.document.querySelector('#auth-form'));
  set(w,'email','second@example.com');set(w,'password','correct-password');submit(w,'#auth-form');await waitFor(()=>w.document.querySelector('[data-nav="My Subjects"]'));
  click(w,'[data-nav="My Subjects"]');assert.doesNotMatch(w.document.body.textContent,/Private subject/);
  w.close();
});

test('failed logout keeps the dashboard available and can be retried', async()=>{
  const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{url:'http://localhost:8000',runScripts:'outside-only'}),w=dom.window;
  w.indexedDB=new IDBFactory();w.scrollTo=()=>{};let calls=0;
  w.fetch=async(url)=>{
    if(url==='/api/auth/session') return {ok:true,status:200,json:async()=>({user:{id:'first',email:'first@example.com'}})};
    if(url==='/api/auth/logout'){calls++;return {ok:false,status:503}};
    throw Error('Unexpected endpoint');
  };
  w.eval(fs.readFileSync('topic.js','utf8')+'\n'+fs.readFileSync('auth-ui.js','utf8')+'\n'+fs.readFileSync('app.js','utf8'));
  await waitFor(()=>w.document.querySelector('.topbar [data-action="sign-out"]'));
  click(w,'.topbar [data-action="sign-out"]');
  await waitFor(()=>w.document.querySelector('#toast').textContent.includes('Could not log out'));
  assert.ok(w.document.querySelector('.topbar [data-action="sign-out"]'));assert.equal(w.document.querySelector('.topbar [data-action="sign-out"]').disabled,false);
  click(w,'.topbar [data-action="sign-out"]');await waitFor(()=>calls===2);
  w.close();
});

test('previous anonymous workspace and PDF can be copied without deleting the original', async()=>{
  const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{url:'http://localhost:8000',runScripts:'outside-only'}),w=dom.window;
  w.indexedDB=new IDBFactory();w.confirm=()=>true;w.scrollTo=()=>{};
  const legacy={profile:{name:'Learner'},subjects:[{id:'s',name:'Math'}],topics:[{id:'t',subjectId:'s',name:'Algebra',status:'Not started',pdf:{id:'p',name:'a.pdf',pages:1,visited:[]}}],resources:[],notes:[],questions:[],attempts:[],cards:[],sessions:[],goals:[],activity:[],readNotifications:[]};
  w.localStorage.setItem('ilearn-data-v1',JSON.stringify(legacy));
  const old=await new Promise((resolve,reject)=>{const req=w.indexedDB.open('ilearn-pdfs-v1',1);req.onupgradeneeded=()=>req.result.createObjectStore('files');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
  await new Promise((resolve,reject)=>{const tx=old.transaction('files','readwrite');tx.objectStore('files').put(new Blob(['%PDF test']),'p');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});old.close();
  w.fetch=async()=>({ok:true,status:200,json:async()=>({user:{id:'first',email:'first@example.com'}})});
  w.eval(fs.readFileSync('topic.js','utf8')+'\n'+fs.readFileSync('auth-ui.js','utf8')+'\n'+fs.readFileSync('app.js','utf8'));
  await waitFor(()=>w.document.querySelector('[data-nav="Settings"]'));click(w,'[data-nav="Settings"]');click(w,'[data-action="import-legacy"]');
  await waitFor(()=>w.localStorage.getItem('ilearn-data-v1:first'));
  const copied=JSON.parse(w.localStorage.getItem('ilearn-data-v1:first'));assert.equal(copied.topics[0].pdfs[0].id,'p');assert.ok(w.localStorage.getItem('ilearn-data-v1'));
  const accountDB=await new Promise((resolve,reject)=>{const req=w.indexedDB.open('ilearn-pdfs-v1:first',1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
  const saved=await new Promise((resolve,reject)=>{const req=accountDB.transaction('files').objectStore('files').get('p');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});assert.ok(saved);accountDB.close();w.close();
});

test('registration validates confirmation and explains when session cookies are blocked', async()=>{
  const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{url:'https://preview.example/',runScripts:'outside-only'}),w=dom.window;
  w.indexedDB=new IDBFactory();let registrations=0;
  w.fetch=async(url)=>{if(url==='/api/auth/session')return {ok:false,status:401,json:async()=>({})};if(url==='/api/auth/register'){registrations++;return {ok:true,status:201,json:async()=>({user:{id:'a',email:'first@example.com'}})}};throw Error('Unexpected endpoint')};
  w.eval(fs.readFileSync('topic.js','utf8')+'\n'+fs.readFileSync('auth-ui.js','utf8')+'\n'+fs.readFileSync('app.js','utf8'));
  await waitFor(()=>w.document.querySelector('#auth-form'));click(w,'#auth-register-tab');
  set(w,'email','first@example.com');set(w,'password','my-good-password');set(w,'confirmPassword','a-different-password');submit(w,'#auth-form');
  assert.match(w.document.querySelector('#auth-error').textContent,/do not match/);assert.equal(registrations,0);
  set(w,'confirmPassword','my-good-password');submit(w,'#auth-form');
  await waitFor(()=>!w.document.querySelector('#auth-open-tab').hidden);
  assert.equal(registrations,1);assert.match(w.document.querySelector('#auth-error').textContent,/blocked/);assert.equal(w.document.querySelector('#auth-open-tab a').target,'_blank');assert.ok(!w.document.querySelector('[data-nav="My Subjects"]'));
  w.close();
});
