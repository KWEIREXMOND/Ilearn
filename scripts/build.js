'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname,'..'), out = path.join(root,'public');
fs.rmSync(out,{recursive:true,force:true}); fs.mkdirSync(out,{recursive:true});
function copy(from,to){const dest=path.join(out,to);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.cpSync(path.join(root,from),dest,{recursive:true})}
for(const name of ['index.html','app.js','topic.js','auth-ui.js','styles.css'])copy(name,name);
copy('node_modules/pdfjs-dist/build/pdf.mjs','vendor/pdf.mjs');
copy('node_modules/pdfjs-dist/build/pdf.worker.mjs','vendor/pdf.worker.mjs');
copy('node_modules/pdfjs-dist/cmaps','vendor/cmaps');copy('node_modules/pdfjs-dist/standard_fonts','vendor/standard_fonts');
copy('node_modules/tesseract.js/dist/tesseract.esm.min.js','vendor/tesseract.mjs');
copy('node_modules/tesseract.js/dist/worker.min.js','vendor/ocr/worker.min.js');
copy('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz','vendor/ocr/lang/eng.traineddata.gz');
for(const name of ['tesseract-core-lstm.wasm.js','tesseract-core-simd-lstm.wasm.js'])copy(`node_modules/tesseract.js-core/${name}`,`vendor/ocr/core/${name}`);
console.log('Built static files in public/');
