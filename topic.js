// Topic learning paths use shared topic records, question records and submitted attempts.
let currentTopicId = null;
let readerOpen = false;
let readerPage = 1;
let pdfRenderToken = 0;
let pdfLibraryPromise;
let PDF_DB = 'ilearn-pdfs-v1';
function migrateTopicPdfs(t) { if (!Array.isArray(t.pdfs)) t.pdfs = t.pdf ? [t.pdf] : []; if (t.pdf) delete t.pdf; if (!t.selectedPdfId && t.pdfs.length) t.selectedPdfId = t.pdfs[0].id; }
function topicPdfs(t) { if (!t) return []; migrateTopicPdfs(t); return t.pdfs; }
function topicPdf(t) { const files = topicPdfs(t); return files.find(p => p.id === t.selectedPdfId) || files[0] || null; }
const PDF_LIMIT = 15 * 1024 * 1024;
const SOURCE_LIMIT = 12000;

function pdfLibrary() {
  if (!pdfLibraryPromise) pdfLibraryPromise = import('/vendor/pdf.mjs').then(lib => {
    lib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.mjs';
    return lib;
  }).catch(err => { pdfLibraryPromise = null; throw err; });
  return pdfLibraryPromise;
}
function openPdfDB(name = PDF_DB) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function pdfStore(operation, key, value, dbName = PDF_DB) {
  const db = await openPdfDB(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', operation === 'get' ? 'readonly' : 'readwrite');
    const store = tx.objectStore('files');
    const request = operation === 'put' ? store.put(value, key) : operation === 'delete' ? store.delete(key) : store.get(key);
    let result;
    request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || request.error); };
  });
}
async function pdfDocument(pdf) {
  const blob = await pdfStore('get', pdf.id);
  if (!blob) throw new Error('The PDF is missing from this browser. Please upload it again.');
  const lib = await pdfLibrary();
  return lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), standardFontDataUrl: '/vendor/standard_fonts/', cMapUrl: '/vendor/cmaps/', cMapPacked: true }).promise;
}
function lessonStepDone(step) {
  return data.attempts.some(a => a.lessonStepId === step.id && a.responses.some(r => r.questionId === step.questionId && r.correct));
}
function topicProgress(t) {
  const pdf = topicPdf(t);
  if (t.activePath === 'pdf' && pdf?.pages) return Math.round((new Set(pdf.visited || []).size / pdf.pages) * 100);
  if (t.activePath === 'lesson' && t.lesson?.steps?.length) return Math.round(t.lesson.steps.filter(lessonStepDone).length / t.lesson.steps.length * 100);
  return t.status === 'Completed' ? 100 : 0;
}
function topicStatus(t) {
  if ((t.activePath === 'pdf' && topicPdf(t)) || (t.activePath === 'lesson' && t.lesson)) {
    let n = topicProgress(t); return n === 100 ? 'Completed' : n > 0 ? 'In progress' : 'Not started';
  }
  return t.status || 'Not started';
}
function topicPage() {
  const t = topic(currentTopicId);
  if (!t) { page = 'My Subjects'; return subjectsPage(); }
  const s = subject(t.subjectId);
  const progress = topicProgress(t);
  const lesson = t.lesson, pdf = topicPdf(t), pdfs = topicPdfs(t);
  return `<button class="text-button" data-action="back-subject">← ${esc(s?.name || 'Subject')}</button>
  <div class="topic-heading"><div><div class="eyebrow">${esc(s?.name || 'Subject')} / Topic</div><h1>${esc(t.name)}</h1><p>Choose how you want to learn, then pick up right where you left off.</p></div><span class="pill" id="topic-status">${esc(topicStatus(t))}</span></div>
  <div class="topic-progress-card"><div><div class="eyebrow">Your topic progress</div><strong id="topic-progress-text">${progress}% complete</strong><p>${t.activePath === 'pdf' && topicPdf(t) ? 'Based on PDF pages viewed — not a measure of mastery.' : t.activePath === 'lesson' && lesson ? 'Based on lesson checks answered correctly.' : 'Choose a learning path, or use the manual status in your subject.'}</p></div><div class="topic-progress-meter"><div class="progress"><span id="topic-progress-bar" style="width:${progress}%"></span></div></div></div>
  <div class="section-title"><div><h2>Your learning paths</h2><p>Switch paths at any time. Each keeps its own progress.</p></div></div>
  <div class="learning-paths"><div class="card path-card"><div class="path-card-top"><div class="subject-icon">${icon('library')}</div>${t.activePath === 'pdf' && pdf ? '<span class="pill">Active path</span>' : ''}</div><h2>Read a PDF</h2><p>Choose a PDF for reading progress, or add another document.</p>${pdf ? `<div class="field pdf-picker"><label for="topic-pdf-select">Selected PDF</label><select id="topic-pdf-select" aria-label="Choose a PDF">${pdfs.map(p=>`<option value="${esc(p.id)}" ${p.id===pdf.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div><div class="path-file"><strong>${esc(pdf.name)}</strong><span id="pdf-progress">${new Set(pdf.visited || []).size} of ${pdf.pages} pages viewed</span></div><div class="tile-actions"><button class="button" data-action="open-pdf">${readerOpen ? 'Close reader' : 'Open PDF'}</button>${t.activePath !== 'pdf' ? '<button class="button secondary" data-action="select-pdf">Use for progress</button>' : ''}<button class="small-button" data-action="upload-pdf">Add PDF</button><button class="small-button" data-action="remove-pdf">Remove selected</button></div>` : `<div class="tile-actions"><button class="button secondary" data-action="upload-pdf">${icon('plus')} Upload a PDF</button></div>`}</div>
  <div class="card path-card"><div class="path-card-top"><div class="subject-icon purple-icon">${icon('spark')}</div>${t.activePath === 'lesson' && lesson ? '<span class="pill">Active path</span>' : ''}</div><h2>Learn step by step</h2><p>Get an AI-generated lesson with a quick check after every step.</p>${lesson ? `<div class="path-file"><strong>${lesson.steps.length} lesson steps</strong><span>${lesson.steps.filter(lessonStepDone).length} checks passed · AI-generated</span></div><div class="tile-actions"><button class="button" data-action="start-lesson">${lesson.steps.some(lessonStepDone) ? 'Continue lesson' : 'Start lesson'}</button>${t.activePath !== 'lesson' ? '<button class="button secondary" data-action="select-lesson">Use for progress</button>' : ''}<button class="small-button" data-action="remove-lesson">Remove lesson</button></div>` : `<div class="tile-actions"><button class="button secondary" data-action="generate-lesson">${icon('spark')} Generate lesson</button></div>`}</div></div>
  ${readerOpen && pdf ? `<div class="card reader-card"><div class="card-title"><div><h2>PDF reader</h2><p>${esc(pdf.name)} · Pages are counted when displayed, not when comprehension is verified.</p></div><button class="text-button" data-action="open-pdf">Close reader</button></div><div class="reader-toolbar"><button class="small-button" data-action="pdf-prev" ${readerPage <= 1 ? 'disabled' : ''}>← Previous</button><span>Page ${readerPage} of ${pdf.pages}</span><button class="small-button" data-action="pdf-next" ${readerPage >= pdf.pages ? 'disabled' : ''}>Next →</button></div><div class="pdf-canvas-wrap"><canvas id="pdf-canvas" aria-label="PDF page ${readerPage}"></canvas><p id="pdf-loading">Loading page…</p></div><details class="pdf-text"><summary>Show extracted page text</summary><p id="pdf-page-text">Loading text…</p></details></div>` : ''}
  <div class="card topic-practice">${cardTitle('Practice this topic','Turn what you are learning into practice questions.')}<p>Generate questions from the topic or use text extracted from your PDF.</p><button class="button secondary" data-action="topic-questions">${icon('practice')} Generate practice questions</button></div>`;
}
function renderTopicAfter() {
  if (page === 'Topic' && readerOpen && topicPdf(topic(currentTopicId))) renderPdfPage(topic(currentTopicId), readerPage);
}
async function renderPdfPage(t, number) {
  const pdf = topicPdf(t);
  const token = ++pdfRenderToken;
  let doc;
  try {
    doc = await pdfDocument(pdf);
    const pdfPage = await doc.getPage(number);
    if (token !== pdfRenderToken || page !== 'Topic' || currentTopicId !== t.id) return;
    const canvas = document.querySelector('#pdf-canvas');
    if (!canvas) return;
    const base = pdfPage.getViewport({ scale: 1 });
    const width = Math.min(800, Math.max(300, canvas.parentElement.clientWidth - 24));
    const viewport = pdfPage.getViewport({ scale: width / base.width });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(viewport.width * dpr); canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
    await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport, transform: [dpr, 0, 0, dpr, 0, 0] }).promise;
    if (token !== pdfRenderToken || !canvas.isConnected) return;
    document.querySelector('#pdf-loading').hidden = true;
    const content = await pdfPage.getTextContent();
    if (token !== pdfRenderToken || !canvas.isConnected) return;
    document.querySelector('#pdf-page-text').textContent = content.items.map(item => item.str || '').join(' ') || 'No selectable text was found on this page.';
    const visited = pdf.visited || (pdf.visited = []);
    if (!visited.includes(number)) {
      visited.push(number);
      if (visited.length === pdf.pages) record('topic', `Viewed all pages of ${t.name}`);
      save();
      const pdfProgress = document.querySelector('#pdf-progress'); if (pdfProgress) pdfProgress.textContent = `${visited.length} of ${pdf.pages} pages viewed`;
      if (t.activePath === 'pdf') {
        const n = topicProgress(t), text = document.querySelector('#topic-progress-text'), bar = document.querySelector('#topic-progress-bar');
        if (text) text.textContent = `${n}% complete`; if (bar) bar.style.width = `${n}%`; const status = document.querySelector('#topic-status'); if (status) status.textContent = topicStatus(t);
      }
    }
  } catch (err) {
    if (token === pdfRenderToken) { const el = document.querySelector('#pdf-loading'); if (el) el.textContent = err.message || 'Could not display this PDF.'; }
  } finally { if (doc) await doc.destroy(); }
}
const MAX_OCR_PAGES = 5;
const MIN_SELECTABLE_TEXT = 40;
async function createOcrWorker(onProgress) {
  const { default: Tesseract } = await import('/vendor/tesseract.mjs');
  return Tesseract.createWorker('eng', 1, {
    workerPath: '/vendor/ocr/worker.min.js', corePath: '/vendor/ocr/core', langPath: '/vendor/ocr/lang',
    workerBlobURL: false, cacheMethod: 'none',
    logger: message => { if (message.status && onProgress) onProgress(message.status); }
  });
}
function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
  return new Promise((resolve, reject) => {
    const cancel = () => { signal.removeEventListener('abort', cancel); reject(new DOMException('Cancelled', 'AbortError')); };
    signal.addEventListener('abort', cancel, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}
async function pdfSource(t, { signal, onProgress, pdfId } = {}) {
  const pdf = pdfId ? topicPdfs(t).find(p=>p.id===pdfId) : topicPdf(t);
  if (!pdf) throw new Error('Choose an available PDF attached to this topic.');
  let doc, worker, text = '', truncated = false, ocrPages = 0, processedPages = 0;
  const check = () => { if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError'); };
  try {
    check(); doc = await pdfDocument(pdf); check();
    for (let i = 1; i <= doc.numPages; i++) {
      check(); onProgress?.(`Reading page ${i} of ${doc.numPages}…`);
      const page = await doc.getPage(i), content = await page.getTextContent();
      check(); let pageText = content.items.map(item => item.str || '').join(' ').trim();
      // Pages with only a header/footer often still contain a scanned image.
      if (pageText.length < MIN_SELECTABLE_TEXT) {
        if (ocrPages >= MAX_OCR_PAGES) { truncated = true; break; }
        onProgress?.(`Running English OCR on page ${i} (up to ${MAX_OCR_PAGES} scanned pages)…`);
        if (!worker) {
          const creating = createOcrWorker(status => onProgress?.(`Preparing OCR: ${status}…`));
          // If cancelled while the worker initializes, clean it up when it eventually starts.
          creating.then(w => { if (signal?.aborted) w.terminate(); }, () => {});
          worker = await abortable(creating, signal);
        }
        check();
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(2, 2400 / Math.max(base.width, base.height), Math.sqrt(6000000 / (base.width * base.height)));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('This browser cannot render the page for OCR.');
        try {
          await page.render({ canvasContext: context, viewport }).promise;
          check(); const result = await abortable(worker.recognize(canvas), signal); check();
          const recognized = (result?.data?.text || '').trim();
          if (recognized.length > pageText.length) pageText = recognized;
        } finally { canvas.width = 0; canvas.height = 0; }
        ocrPages++;
      }
      processedPages = i;
      if (text.length + pageText.length + 1 > SOURCE_LIMIT) { text += '\n' + pageText; truncated = true; break; }
      text += '\n' + pageText;
    }
    text = text.trim();
    if (!text) throw new Error('No text could be recognized in the pages checked. Try a clearer, upright English scan, or paste the material manually.');
    return { text: text.slice(0, SOURCE_LIMIT), truncated, ocrPages, processedPages, totalPages: doc.numPages };
  } finally {
    if (worker) await worker.terminate();
    if (doc) await doc.destroy();
  }
}
function sourceSummary(result) {
  const pages = result.processedPages && result.totalPages ? `Pages 1–${result.processedPages} of ${result.totalPages}. ` : '';
  const ocr = result.ocrPages ? `English OCR used on ${result.ocrPages} page${result.ocrPages === 1 ? '' : 's'}; it can make mistakes. ` : '';
  return pages + ocr + (result.truncated ? 'Only part of the PDF was extracted. ' : '') + 'Review and edit the text before generating.';
}

function uploadPdfModal(t) {
  document.querySelector('#modal-root').innerHTML = `<div class="modal-overlay"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><h2 id="modal-title">Upload a PDF</h2><p class="description">Saved only in this browser. Maximum 15 MB and 500 pages per file.</p><form id="pdf-upload-form"><div class="field"><label for="pdf-file">Choose PDF</label><input id="pdf-file" type="file" accept="application/pdf,.pdf" required></div><div id="pdf-upload-error" class="notice warning" role="alert" hidden></div><div class="modal-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">Save PDF</button></div></form></div></div>`;
  const form = document.querySelector('#pdf-upload-form');
  form.onsubmit = async e => {
    e.preventDefault(); const accountId=currentUser?.id, dbName=PDF_DB; const file = form.querySelector('input').files[0], error = document.querySelector('#pdf-upload-error'), submit = form.querySelector('[type=submit]');
    try {
      if (!file || file.size > PDF_LIMIT || file.size < 5 || !file.name.toLowerCase().endsWith('.pdf')) throw new Error('Choose a PDF file no larger than 15 MB.');
      submit.disabled = true; submit.textContent = 'Checking PDF…';
      const signature = new TextDecoder().decode(await file.slice(0, 1024).arrayBuffer());
      if (!signature.includes('%PDF-')) throw new Error('This file does not appear to be a PDF.');
      const lib = await pdfLibrary(); let doc;
      try { doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), standardFontDataUrl: '/vendor/standard_fonts/', cMapUrl: '/vendor/cmaps/', cMapPacked: true }).promise; }
      catch { throw new Error('Could not open this PDF. Encrypted or damaged PDFs are not supported.'); }
      const pages = doc.numPages; await doc.destroy();
      if (!pages || pages > 500) throw new Error('PDFs must have between 1 and 500 pages.');
      if (!form.isConnected) return;
      const id = uid(), oldPath = t.activePath, oldSelected = t.selectedPdfId;
      await pdfStore('put', id, file, dbName);
      if (!form.isConnected || currentUser?.id !== accountId) { await pdfStore('delete', id, undefined, dbName); return; }
      topicPdfs(t).push({ id, name: file.name.slice(0, 200), pages, visited: [] }); t.selectedPdfId = id; t.activePath = 'pdf';
      try { save(); } catch (err) { t.pdfs = t.pdfs.filter(p => p.id !== id); t.selectedPdfId = oldSelected; t.activePath = oldPath; await pdfStore('delete', id, undefined, dbName); throw err; }
      readerOpen = false; closeModal(); render(); toast('PDF added to this topic.');
    } catch (err) { error.textContent = err.message || 'Could not save the PDF in this browser.'; error.hidden = false; submit.disabled = false; submit.textContent = 'Save PDF'; }
  };
}
let lessonStepIndex = 0;
function lessonPage() {
  const t = topic(currentTopicId), lesson = t?.lesson;
  if (!lesson?.steps?.length) { page = 'Topic'; return topicPage(); }
  lessonStepIndex = Math.max(0, Math.min(lessonStepIndex, lesson.steps.length - 1));
  const step = lesson.steps[lessonStepIndex], q = data.questions.find(q => q.id === step.questionId);
  const last = [...data.attempts].reverse().find(a => a.lessonStepId === step.id && a.responses.some(r => r.questionId === step.questionId));
  const response = last?.responses.find(r => r.questionId === step.questionId);
  const done = lessonStepDone(step), passed = lesson.steps.filter(lessonStepDone).length;
  return `<button class="text-button" data-action="back-topic">← Back to ${esc(t.name)}</button><div class="topic-heading"><div><div class="eyebrow">AI-generated lesson · ${esc(subject(t.subjectId)?.name || '')}</div><h1>${esc(t.name)}</h1><p>Learn one step at a time and check your understanding as you go.</p></div><span class="pill">${passed} / ${lesson.steps.length} checks passed</span></div><div class="notice warning">This lesson and its answers were generated by AI, not verified as official material. Check important information against trusted sources.</div><div class="lesson-layout"><aside class="card lesson-steps"><h2>Lesson steps</h2>${lesson.steps.map((item,i)=>`<button class="lesson-step ${i===lessonStepIndex?'active':''}" data-action="lesson-go" data-index="${i}" ${i>0&&!lessonStepDone(lesson.steps[i-1])?'disabled':''}><span>${lessonStepDone(item)?'✓':i+1}</span><div>${esc(item.title)}</div></button>`).join('')}</aside><div><div class="card lesson-content"><div class="eyebrow">Step ${lessonStepIndex+1} of ${lesson.steps.length}</div><h2>${esc(step.title)}</h2><div class="lesson-copy">${esc(step.content)}</div></div><div class="card lesson-check"><div class="eyebrow">Check your understanding</div>${q ? `<h2>${esc(q.text)}</h2>${response ? `<div class="notice ${response.correct?'':'warning'}"><strong>${response.correct?'Correct!':'Not quite — try again.'}</strong><br>${esc(q.explanation)}</div>` : ''}${!done ? `<form id="lesson-check-form"><div class="lesson-options">${q.options.map((o,i)=>`<label><input type="radio" name="answer" value="${i}" required> ${esc(o)}</label>`).join('')}</div><button class="button" type="submit">Check answer</button></form>` : `<div class="tile-actions">${lessonStepIndex < lesson.steps.length-1 ? `<button class="button" data-action="lesson-next">Next step ${icon('arrow')}</button>` : `<button class="button" data-action="back-topic">Finish lesson ${icon('check')}</button>`}</div>`}` : '<div class="notice warning">This lesson question is missing. Return to the topic and remove the lesson to start again.</div>'}</div></div></div>`;
}
function submitLessonCheck(form) {
  const t = topic(currentTopicId), step = t?.lesson?.steps[lessonStepIndex], q = data.questions.find(q => q.id === step?.questionId);
  if (!step || !q) return;
  const raw = new FormData(form).get('answer'); if (raw === null) return toast('Choose an answer first.');
  const answer = Number(raw); if (!Number.isInteger(answer) || answer < 0 || answer >= q.options.length) return;
  const wasDone = lessonStepDone(step), correct = answer === q.answer;
  data.attempts.push({ id: uid(), date: new Date().toISOString(), lessonStepId: step.id, responses: [{ questionId:q.id, answer, correct }], total:1, correct:correct?1:0, unanswered:0 });
  if (correct && !wasDone) record('assessment', `Passed a lesson check in ${t.name}`);
  save(); render();
}
function lessonGenerationModal(t) {
  document.querySelector('#modal-root').innerHTML = `<div class="modal-overlay"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><h2 id="modal-title">Generate a lesson</h2><p class="description">Gemini will create a guided lesson and a multiple-choice check for each step. Answers may contain mistakes.</p><form id="lesson-generation-form"><div class="form-grid">${select('Number of steps','count',[['2','2 steps'],['3','3 steps'],['4','4 steps'],['5','5 steps'],['6','6 steps']],'3')}${select('Source','sourceType',topicPdf(t)?[['topic','Topic knowledge'],['pdf','Text extracted from your PDF']]:[['topic','Topic knowledge']])}<div id="lesson-pdf-source" hidden>${select('PDF for this lesson','pdfId',topicPdfs(t).map(p=>[p.id,p.name]),topicPdf(t)?.id)}<p class="description">Extract and review your source before generating. Scanned pages use English OCR in your browser (up to 5 scanned pages, 12,000 characters); OCR may make mistakes.</p><button class="small-button" type="button" id="lesson-extract">Extract PDF text</button><p class="meta" id="lesson-source-info" role="status"></p>${field('Review source text','sourceText','',{textarea:true,max:12000,placeholder:'Extract PDF text or paste material here.'})}</div></div><p class="description" style="margin:12px 0 0">The subject, topic, and reviewed source text are sent to Gemini when you generate.</p><div id="lesson-generation-error" class="notice warning" role="alert" hidden></div><div class="modal-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">Generate lesson</button></div></form></div></div>`;
  const form = document.querySelector('#lesson-generation-form'), pdfSection=form.querySelector('#lesson-pdf-source');
  form.elements.sourceType.addEventListener('change',()=>{pdfSection.hidden=form.elements.sourceType.value!=='pdf'});
  let lastPdfId=form.elements.pdfId.value;
  form.elements.pdfId.addEventListener('change',()=>{if(form.elements.sourceText.value&&!confirm('Change PDF and clear the current source text?')){form.elements.pdfId.value=lastPdfId;return}lastPdfId=form.elements.pdfId.value;form.elements.sourceText.value='';form.querySelector('#lesson-source-info').textContent='PDF changed. Extract text from the selected PDF.'});
  form.querySelector('#lesson-extract').addEventListener('click',async()=>{
    if(activeGeneration)return;
    if(form.elements.sourceText.value&&!confirm('Replace the source text with text from the PDF?'))return;
    const controller=new AbortController(), extract=form.querySelector('#lesson-extract'), submit=form.querySelector('[type=submit]'), info=form.querySelector('#lesson-source-info');
    activeGeneration=controller;extract.disabled=true;submit.disabled=true;form.elements.sourceType.disabled=true;form.elements.pdfId.disabled=true;info.textContent='Extracting PDF text…';
    try{
      const selectedPdfId=form.elements.pdfId.value;
      const result=await pdfSource(t,{pdfId:selectedPdfId,signal:controller.signal,onProgress:message=>{info.textContent=message}});
      if(controller.signal.aborted)return;
      form.elements.sourceText.value=result.text;info.textContent=sourceSummary(result);
    }catch(err){if(err.name!=='AbortError')info.textContent=err.message||'Could not extract PDF text.'}
    finally{if(activeGeneration===controller)activeGeneration=null;extract.disabled=false;submit.disabled=false;form.elements.sourceType.disabled=false;form.elements.pdfId.disabled=false}
  });
  form.onsubmit = async e => {
    e.preventDefault(); const submit = form.querySelector('[type=submit]'), error = document.querySelector('#lesson-generation-error');
    submit.disabled = true; submit.textContent = 'Generating…'; error.hidden = true;
    const controller = new AbortController(); activeGeneration = controller;
    try {
      const v = Object.fromEntries(new FormData(form));
      const source = v.sourceType === 'pdf' ? (v.sourceText || '').trim() : '';
      if (v.sourceType === 'pdf' && !source) throw Error('Extract or paste PDF text, then review it before generating.');
      if (controller.signal.aborted) return;
      const res = await fetch('/api/generate-lesson', { method:'POST', headers:{'Content-Type':'application/json'}, signal:controller.signal, body:JSON.stringify({ subject:subject(t.subjectId).name, topic:t.name, count:Number(v.count), source }) });
      let result; try { result = await res.json(); } catch { throw Error('The lesson service is unavailable. Please try again.'); }
      if (res.status === 401) { sessionExpired(); return; }
      if (!res.ok) throw Error(result.error || 'Could not generate a lesson.');
      if (!Array.isArray(result.steps) || !result.steps.length) throw Error('No lesson was returned.');
      const normalize = text => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
      const seen = new Set(data.questions.map(q => normalize(q.text)));
      if (result.steps.some(step => seen.has(normalize(step.question.text)))) throw Error('A generated check duplicates a question in your bank. Please try generating again.');
      const steps = result.steps.map(step => {
        const questionId = uid();
        data.questions.push({ id:questionId, ...step.question, subjectId:t.subjectId, topicId:t.id, origin:'gemini', format:'multiple-choice' });
        return { id:uid(), title:step.title, content:step.content, questionId };
      });
      const oldLesson = t.lesson, oldPath = t.activePath;
      t.lesson = { id:uid(), steps, source:v.sourceType, sourcePdfId:v.sourceType==='pdf'?v.pdfId:null, sourcePdfName:v.sourceType==='pdf'?topicPdfs(t).find(p=>p.id===v.pdfId)?.name||null:null, created:new Date().toISOString() }; t.activePath = 'lesson';
      try { save(); } catch (err) { t.lesson = oldLesson; t.activePath = oldPath; const ids = new Set(steps.map(step => step.questionId)); data.questions = data.questions.filter(q => !ids.has(q.id)); throw err; }
      activeGeneration = null; closeModal(); readerOpen = false; render(); toast('Your AI-generated lesson is ready.');
    } catch (err) { if (err.name === 'AbortError' || controller.signal.aborted) return; error.textContent = err.message || 'Could not generate a lesson. Please try again.'; error.hidden = false; submit.disabled = false; submit.textContent = 'Generate lesson'; activeGeneration = null; }
  };
}
