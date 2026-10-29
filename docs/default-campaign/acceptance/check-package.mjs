import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const repo=process.cwd();
const pages=['docs/default-campaign/index.html','docs/default-campaign/actual/index.html','docs/default-campaign/replay/index.html','docs/default-campaign/replay/phase40/index.html','docs/default-campaign/replay/phase50/index.html','docs/default-campaign/replay/final/index.html','docs/development.html'];
let links=0;
for(const name of pages){
 const html=fs.readFileSync(path.join(repo,name),'utf8');
 for(const [,url] of html.matchAll(/(?:href|src)=["']([^"']+)["']/g)){
  if(/^(?:https?:|data:|#)/.test(url))continue;
  assert.ok(fs.existsSync(path.resolve(repo,path.dirname(name),decodeURIComponent(url.split('#')[0]))),`${name} → ${url}`);links++;
 }
}
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',args:['--enable-unsafe-swiftshader']});
const results=[];
try{
 for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const name of pages){
   await page.goto(`http://127.0.0.1:5217/${name}`,{waitUntil:'networkidle'});
   const r=await page.evaluate(async()=>{
    const imgs=[...document.images];for(const img of imgs)img.loading='eager';
    await Promise.all(imgs.map(img=>img.decode()));
    return{overflow:document.documentElement.scrollWidth>innerWidth,images:imgs.length,title:document.title};
   });
   assert.equal(r.overflow,false,`${name} at ${width}`);assert.deepEqual(errors,[]);
   if(name==='docs/default-campaign/index.html')await page.screenshot({path:`docs/default-campaign/acceptance/report-${width}.png`,fullPage:true});
   results.push({name,width,...r});
  }
  await page.close();
 }
}finally{await browser.close();}
fs.writeFileSync('docs/default-campaign/acceptance/package-browser.json',JSON.stringify({localLinks:links,cases:results,pageErrors:0},null,2)+'\n');
console.log(`Verified ${links} local links and ${results.length} desktop/narrow report views.`);
