import {chromium} from '/home/leg/projects/awesome_4x/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const out='/tmp/asterion-stage22-odyssey/docs/odyssey-playtest/acceptance';
const browser=await chromium.launch({headless:true,executablePath:'/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome'});const cases=[];
try{for(const width of [1280,390])for(const file of ['index.html','actual/report/index.html','replay/index.html','strategy/index.html']){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`)});
 const response=await page.goto(`http://127.0.0.1:5214/docs/odyssey-playtest/${file}`);assert.equal(response.status(),200);
 await page.locator('img').evaluateAll(images=>Promise.all(images.map(i=>{i.loading='eager';return i.decode()})));
 const dimensions=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));assert.ok(dimensions.document<=dimensions.viewport,JSON.stringify({file,width,dimensions}));
 const images=await page.locator('img').count();assert.ok(images>0);
 if(file==='index.html')await page.screenshot({path:`${out}/overview-${width}.png`,fullPage:true});
 assert.deepEqual(errors,[]);cases.push({file,width,images,dimensions,errors});await page.close();
}fs.writeFileSync(`${out}/documents-browser.json`,JSON.stringify({cases},null,2)+'\n');console.log(JSON.stringify(cases));}finally{await browser.close()}
