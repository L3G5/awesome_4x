import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from '/home/leg/projects/awesome_4x/node_modules/playwright/index.mjs';
const out='/tmp/asterion-design-guide-review';
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
const results=[];
try{
 for(const name of ['good-4x','bad-4x'])for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:960},reducedMotion:'reduce'}),page=await context.newPage();
  const errors=[],failed=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)failed.push({status:r.status(),url:r.url()});});
  const response=await page.goto(`http://127.0.0.1:5236/design/${name}.html`);assert.equal(response.status(),200);
  await page.screenshot({path:`${out}/${name}-${width}-top.png`});
  await page.locator('#review').screenshot({path:`${out}/${name}-${width}-review.png`});
  const geometry=await page.evaluate(()=>({
   bodyWidth:document.body.clientWidth,scrollWidth:document.documentElement.scrollWidth,
   bodyFont:getComputedStyle(document.body).fontSize,bodyLineHeight:getComputedStyle(document.body).lineHeight,
   tableWidth:document.querySelector('table').getBoundingClientRect().width,tableViewport:document.querySelector('.table-scroll').clientWidth,
   overflowElements:[...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,class:e.className,right:e.getBoundingClientRect().right})),
   headings:[...document.querySelectorAll('h1,h2')].map(e=>({text:e.textContent,font:getComputedStyle(e).fontSize})),
   citationsFont:getComputedStyle(document.querySelector('.sources')).fontSize,
   sourceColor:getComputedStyle(document.querySelector('.sources a')).color,background:getComputedStyle(document.body).backgroundColor,
   smoothScroll:getComputedStyle(document.documentElement).scrollBehavior
  }));
  await page.goto(`http://127.0.0.1:5236/design/${name}.html`);
  await page.keyboard.press('Tab');
  const focus=await page.evaluate(()=>({label:document.activeElement.textContent,outline:getComputedStyle(document.activeElement).outlineStyle,outlineWidth:getComputedStyle(document.activeElement).outlineWidth}));
  await page.locator('a[href="#review"]').first().click();
  assert.equal(await page.locator('#review').isVisible(),true);
  const anchor=await page.evaluate(()=>({hash:location.hash,reviewTop:document.querySelector('#review').getBoundingClientRect().top}));
  results.push({name,width,status:response.status(),geometry,focus,anchor,errors,failed});
  await context.close();
 }
 fs.writeFileSync(`${out}/browser-results.json`,JSON.stringify(results,null,2)+'\n');
 console.log(JSON.stringify(results.map(r=>({name:r.name,width:r.width,bodyWidth:r.geometry.bodyWidth,scrollWidth:r.geometry.scrollWidth,tableWidth:r.geometry.tableWidth,tableViewport:r.geometry.tableViewport,focus:r.focus,anchor:r.anchor,errors:r.errors.length,failed:r.failed.length})),null,2));
}finally{await browser.close();}
