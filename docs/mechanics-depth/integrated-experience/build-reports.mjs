import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const root=new URL('./',import.meta.url).pathname;
const esc=s=>String(s).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function build(folder,title,summary,cards,links){
 const dir=path.join(root,folder), report=fs.readFileSync(path.join(dir,'report.txt'),'utf8');
 const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{margin:0;background:#0c1621;color:#d8e2e8;font:16px/1.65 system-ui,sans-serif}main{max-width:1080px;margin:auto;padding:28px 20px}h1,h2{color:#e5d3aa;line-height:1.3}a{color:#86ded3}p{max-width:80ch}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:22px}figure{margin:0;padding:12px;border:1px solid #456070;border-radius:10px}img{display:block;width:100%;height:420px;object-fit:contain;background:#081018}figcaption{margin-top:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.65 system-ui,sans-serif;background:#11232e;padding:20px;border-radius:10px}nav{display:flex;flex-wrap:wrap;gap:16px;margin:24px 0}</style><main><h1>${esc(title)}</h1><p>${esc(summary)}</p><nav>${links.map(([p,t])=>`<a href="${esc(p)}">${esc(t)}</a>`).join('')}</nav><div class="cards">${cards.map(([p,t])=>`<figure><a href="screens/${esc(p)}-viewport.png"><img src="screens/${esc(p)}-viewport.png" alt="${esc(t)}" loading="lazy"></a><figcaption>${esc(t)} · <a href="text/${esc(p)}.txt">captured text</a></figcaption></figure>`).join('')}</div><h2>Scope and findings</h2><pre>${esc(report)}</pre></main></html>`;
 fs.writeFileSync(path.join(dir,'index.html'),html);
 function walk(p){return fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>{const full=path.join(p,e.name);if(e.isDirectory()){if(!folder&&e.name.startsWith('candidate-'))return [];return walk(full);}return [full];});}
 const files=walk(dir).filter(p=>path.basename(p)!=='manifest.json').sort().map(p=>{const data=fs.readFileSync(p);return{path:path.relative(dir,p),bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')};});
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({generatedAt:new Date().toISOString(),scope:folder?'This immutable-candidate evidence folder.':'Initial a5077ea evidence only; candidate-* subfolders have separate manifests.',files},null,2)+'\n');
}
build('','Initial integrated experience — a5077ea','Three observed usability defects are retained with their original evidence; later immutable candidates are reviewed separately.',[
 ['preview-en-1440-underway-from-other','Misleading prospective cost and7cycle quote beside actual2cycle Eos project.'],
 ['controlled-lifecycle-ru-390-direct-enabled','Narrow Russian direct opener initially scrolls past the dialog title.'],
 ['controlled-lifecycle-en-390-direct-alternate-committed','Correctly queued alternate builder, but idle Nacre remains and focus falls to BODY.'],
 ['ordinary-ru-390-scroll-observation-committed','Ordinary cycle50 replacement commission keeps the chosen world actionable at390px.'],
 ['controlled-lifecycle-ru-390-corrected-completion','Russian completion briefing explains the restored lane is shared.'],
 ['controlled-lifecycle-en-1440-corrected-crossed','Subsequent crossing uses ordinary movement and paid order.']
],[['report.txt','Plain-text report'],['build-before.json','Build/assets'],['preview-results.json','Preview matrix'],['lifecycle-results.json','Original attempts'],['lifecycle-corrected-results.json','Corrected selector run'],['ordinary-scroll-observation-results.json','Scroll observation'],['manifest.json','SHA-256 manifest'],['candidate-v023/index.html','0.23.0 candidate review'],['candidate-focus-correction/index.html','Focused correction acceptance']]);
build('candidate-v023','0.23.0 integrated experience — fbd89a2','The active-project estimate and initial reading-position fixes pass. Alternate-builder Galaxy result focus remains reproducibly incorrect in this frozen candidate.',[
 ['accept-en-1440-initial','The revised quote shows cost, current builder ETA, travel and shared risk.'],
 ['accept-ru-390-initial','Narrow Russian opens at the title with Close focused.'],
 ['accept-ru-390-underway','Only actual Eos project/remaining time appear while restoration is underway.'],
 ['accept-en-390-direct-alternate-committed','Remaining defect: idle Nacre inspector after committing Eos.'],
 ['natural-04-lane-on-map','Natural cycle8 opportunity: dashed Iona–Aster link, destination unsurveyed.'],
 ['natural-05-restoration-decision','Natural preview avoids invented savings when the chart has no known connecting route.'],
 ['foreign-ru-390','Foreign completion time stays unknown; private variants render identically.'],
 ['controlled-lifecycle-ru-390-completion','Completed controlled project produces a translated shared-route briefing.']
],[['report.txt','Plain-text report'],['build-before.json','Build/assets'],['accept-results.json','Acceptance matrix'],['privacy-results.json','Privacy matrix'],['lifecycle-results.json','Lifecycle matrix'],['natural-actions.json','UI-only opening actions'],['natural-decision.json','Natural decision assessment'],['manifest.json','SHA-256 manifest']]);
build('candidate-focus-correction','Focused correction accepted —94f41df','Eight independent cases accept the alternate-builder result focus and Russian Empire scroll correction. Prior failures and broader mechanic checks remain separately pinned.',[
 ['direct-en-1440-committed','Direct alternate-builder commit now shows Eos and focuses its production row.'],
 ['direct-ru-390-initial','Narrow Russian restoration still opens at the beginning with Close focused.'],
 ['direct-ru-390-committed','Actual builder context and selected unrelated fleet both survive the keyboard commit.'],
 ['empire-ru-390-committed','Actual cycle50 Russian narrow commission preserves383px vertical and180px horizontal scroll exactly.']
],[['report.txt','Plain-text report'],['build-before.json','Build/assets before'],['build-after.json','Build/assets after'],['results.json','All8cases'],['accept.mjs','Browser script'],['manifest.json','SHA-256 manifest']]);
