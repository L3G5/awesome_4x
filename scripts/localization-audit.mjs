import fs from 'node:fs';
import { chromium } from 'playwright';
import { translateText } from '../src/localization.js';
const option=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const baseURL=option('--url','http://127.0.0.1:5221/');
const out=option('--out','/tmp/asterion-russian-audit');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const collected=[];
async function record(name){
 await page.waitForTimeout(150);
 const data=await page.evaluate(()=>{
  const texts=[];const tree=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  while(tree.nextNode()){
   const node=tree.currentNode,el=node.parentElement;
   if(el && !el.closest('script,style,[translate="no"]') && el.getClientRects().length && node.textContent.trim())texts.push(node.textContent.trim());
  }
  return {texts,htmlLang:document.documentElement.lang,overflow:document.documentElement.scrollWidth>innerWidth};
 });
 const untranslated=[...new Set(data.texts.filter(text=>/[a-z]{3}/i.test(text) && translateText(text,'ru')===text))];
 collected.push({name,...data,untranslated});
 await page.screenshot({path:`${out}/${name}.png`,fullPage:true});
}
try{
 await page.goto(baseURL);
 await page.locator('.modal [data-action="language"]').click();await record('welcome');
 await page.locator('.modal [data-action="close-modal"]').last().click();await record('galaxy');
 for(const name of ['research','diplomacy','empire','journal']){await page.locator(`[data-page="${name}"]`).click();await record(name);}
 await page.locator('[data-action="menu"]').click();await record('menu');
 fs.writeFileSync(`${out}/report.json`,JSON.stringify({collected,errors},null,2));
 console.log(JSON.stringify({errors,pages:collected.map(({name,htmlLang,overflow,untranslated})=>({name,htmlLang,overflow,untranslated}))},null,2));
}finally{await browser.close();}
