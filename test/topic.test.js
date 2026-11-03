'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const { File } = require('node:buffer');

async function setup(seed) {
  const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), { url:'http://localhost:8000', runScripts:'outside-only' });
  const w = dom.window; w.confirm = () => true; w.scrollTo = () => {};
  w.indexedDB = new IDBFactory(); w.TextDecoder = TextDecoder;
  if (seed) w.localStorage.setItem('ilearn-data-v1:test-user', JSON.stringify(seed));
  w.fetch=async()=>({ok:true,status:200,json:async()=>({user:{id:'test-user',email:'test@example.com'}})});
  w.eval(fs.readFileSync('topic.js','utf8') + '\n' + fs.readFileSync('auth-ui.js','utf8') + '\n' + fs.readFileSync('app.js','utf8'));
  await waitFor(()=>!!w.document.querySelector('[data-nav="My Subjects"]'));
  return w;
}
function click(w, selector) { const el = w.document.querySelector(selector); assert.ok(el, `Missing ${selector}`); el.click(); }
function submit(w, selector) { const el = w.document.querySelector(selector); assert.ok(el); el.dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true })); }
function waitFor(check) { return new Promise((resolve, reject) => { let n=0; const timer=setInterval(()=>{ if(check()){clearInterval(timer);resolve()} else if(++n>100){clearInterval(timer);reject(Error('Timed out'))} },10); }); }
function stored(w) { return JSON.parse(w.localStorage.getItem('ilearn-data-v1:test-user')); }
function seed() { return { profile:{ name:'Learner', level:'', timezone:'UTC' }, subjects:[{id:'s', name:'Math'}], topics:[{id:'t',subjectId:'s',name:'Algebra',status:'Not started'}], resources:[], notes:[], questions:[], attempts:[], cards:[], sessions:[], goals:[], activity:[], readNotifications:[] }; }

test('PDF upload, page viewing, progress and extraction for practice', async () => {
  const w = await setup(seed());
  w.HTMLCanvasElement.prototype.getContext = () => ({});
  const fakeDoc = () => ({ numPages:2, destroy:async()=>{}, getPage:async n=>({ getViewport:({scale})=>({width:500*scale,height:600*scale}), render:()=>({promise:Promise.resolve()}), getTextContent:async()=>({items:[{str:`PDF page ${n} algebra with enough selectable text for a full lesson.`}]}) }) });
  w.pdfLibrary = async () => ({ getDocument:()=>({ promise:Promise.resolve(fakeDoc()) }) });
  click(w,'[data-nav="My Subjects"]'); click(w,'[data-action="view-subject"]'); click(w,'[data-action="view-topic"]');
  click(w,'[data-action="upload-pdf"]');
  const file = new File(['%PDF-1.4 sample'], 'algebra.pdf', { type:'application/pdf' });
  Object.defineProperty(w.document.querySelector('#pdf-file'),'files',{value:[file]});
  submit(w,'#pdf-upload-form');
  await waitFor(()=>stored(w).topics[0].pdfs?.length);
  assert.equal(stored(w).topics[0].activePath,'pdf');
  click(w,'[data-action="open-pdf"]');
  await waitFor(()=>stored(w).topics[0].pdfs[0].visited.length===1);
  assert.match(w.document.querySelector('#topic-progress-text').textContent,/50%/);
  click(w,'[data-action="pdf-next"]'); await waitFor(()=>stored(w).topics[0].pdfs[0].visited.length===2);
  assert.match(w.document.querySelector('#topic-progress-text').textContent,/100%/);
  click(w,'[data-action="topic-questions"]'); click(w,'#use-pdf-source');
  await waitFor(()=>w.document.querySelector('#generation-form [name=source]').value.includes('page 2'));
  assert.match(w.document.querySelector('#generation-form [name=source]').value,/PDF page 1/);
  w.close();
});

test('AI lesson checks save attempts and drive topic progress', async () => {
  const w=await setup(seed());
  const q=(text)=>({text,options:['Correct','Wrong','Another','Last'],answer:0,explanation:'Because this is correct.'});
  w.fetch=async()=>({ok:true,json:async()=>({steps:[{title:'First',content:'First lesson',question:q('Question 1')},{title:'Second',content:'Second lesson',question:q('Question 2')}]})});
  click(w,'[data-nav="My Subjects"]');click(w,'[data-action="view-subject"]');click(w,'[data-action="view-topic"]');click(w,'[data-action="generate-lesson"]');
  w.document.querySelector('#lesson-generation-form [name=count]').value='2';submit(w,'#lesson-generation-form');
  await waitFor(()=>stored(w).topics[0].lesson);
  click(w,'[data-action="start-lesson"]');
  w.document.querySelector('#lesson-check-form input[value="1"]').checked=true;submit(w,'#lesson-check-form');
  assert.match(w.document.body.textContent,/Not quite/);assert.equal(stored(w).attempts[0].correct,0);
  w.document.querySelector('#lesson-check-form input[value="0"]').checked=true;submit(w,'#lesson-check-form');
  assert.match(w.document.body.textContent,/Correct!/);click(w,'[data-action="lesson-next"]');
  w.document.querySelector('#lesson-check-form input[value="0"]').checked=true;submit(w,'#lesson-check-form');
  assert.equal(stored(w).attempts.length,3);click(w,'[data-action="back-topic"]');
  assert.match(w.document.querySelector('#topic-progress-text').textContent,/100%/);
  w.close();
});

test('scanned pages use local OCR, respect the page limit and require lesson source review', async () => {
  const data=seed(); data.topics[0].pdf={id:'pdf',name:'scan.pdf',pages:6,visited:[]};
  const w=await setup(data); w.HTMLCanvasElement.prototype.getContext=()=>({}); let recognized=0, terminated=0;
  w.pdfDocument=async()=>({numPages:6,destroy:async()=>{},getPage:async n=>({getTextContent:async()=>({items:[]}),getViewport:({scale})=>({width:500*scale,height:700*scale}),render:()=>({promise:Promise.resolve()})})});
  w.createOcrWorker=async()=>({recognize:async()=>({data:{text:`Scanned lesson page ${++recognized} explains algebra.`}}),terminate:async()=>{terminated++}});
  click(w,'[data-nav="My Subjects"]');click(w,'[data-action="view-subject"]');click(w,'[data-action="view-topic"]');click(w,'[data-action="topic-questions"]');click(w,'#use-pdf-source');
  await waitFor(()=>!w.document.querySelector('#use-pdf-source').disabled);
  assert.equal(recognized,5);assert.equal(terminated,1);
  assert.match(w.document.querySelector('#pdf-source-info').textContent,/Only part/);
  assert.match(w.document.querySelector('#generation-form [name=source]').value,/Scanned lesson page 5/);
  click(w,'[data-action="close-modal"]');click(w,'[data-action="generate-lesson"]');
  const form=w.document.querySelector('#lesson-generation-form');form.elements.sourceType.value='pdf';form.elements.sourceType.dispatchEvent(new w.Event('change'));
  let fetches=0;w.fetch=async()=>{fetches++;return {ok:false,json:async()=>({error:'test'})}};
  submit(w,'#lesson-generation-form');await waitFor(()=>!form.querySelector('[type=submit]').disabled);
  assert.equal(fetches,0);assert.match(w.document.querySelector('#lesson-generation-error').textContent,/review/);
  click(w,'#lesson-extract');await waitFor(()=>!w.document.querySelector('#lesson-extract').disabled);
  assert.match(form.elements.sourceText.value,/Scanned lesson page/);
  assert.match(w.document.querySelector('#lesson-source-info').textContent,/OCR/);
  w.close();
});

test('chooses among PDFs for topic progress and AI source', async () => {
  const data=seed(); data.topics[0].pdfs=[{id:'first',name:'First.pdf',pages:2,visited:[1]},{id:'second',name:'Second.pdf',pages:4,visited:[]}]; data.topics[0].selectedPdfId='first'; data.topics[0].activePath='pdf';
  const w=await setup(data); const readIds=[];
  w.pdfDocument=async pdf=>{readIds.push(pdf.id);return {numPages:1,destroy:async()=>{},getPage:async()=>({getTextContent:async()=>({items:[{str:`Content of ${pdf.name} with sufficient selectable text for extraction.`}]})})}};
  click(w,'[data-nav="My Subjects"]');click(w,'[data-action="view-subject"]');click(w,'[data-action="view-topic"]');
  assert.match(w.document.querySelector('#topic-progress-text').textContent,/50%/);
  const picker=w.document.querySelector('#topic-pdf-select');picker.value='second';picker.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.match(w.document.querySelector('#topic-progress-text').textContent,/0%/);
  click(w,'[data-action="generate-lesson"]');const form=w.document.querySelector('#lesson-generation-form');form.elements.sourceType.value='pdf';form.elements.sourceType.dispatchEvent(new w.Event('change'));form.elements.pdfId.value='first';form.elements.pdfId.dispatchEvent(new w.Event('change'));
  click(w,'#lesson-extract');await waitFor(()=>!w.document.querySelector('#lesson-extract').disabled);
  assert.equal(readIds.at(-1),'first');assert.match(form.elements.sourceText.value,/First.pdf/);
  click(w,'[data-action="close-modal"]');click(w,'[data-action="topic-questions"]');const qform=w.document.querySelector('#generation-form');qform.elements.pdfId.value='second';click(w,'#use-pdf-source');await waitFor(()=>!w.document.querySelector('#use-pdf-source').disabled);
  assert.equal(readIds.at(-1),'second');assert.match(qform.elements.source.value,/Second.pdf/);
  w.close();
});
