import { chromium } from '/home/leg/projects/awesome_4x/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
const out='/tmp/asterion-critique-experience';const root='/home/leg/projects/awesome_4x';
const browser=await chromium.launch({headless:true,executablePath:'/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',args:['--enable-unsafe-swiftshader']});
const results={};
async function load(path,width=1440){const s=JSON.parse(fs.readFileSync(root+'/'+path));const context=await browser.newContext({viewport:{width,height:960},reducedMotion:'reduce'});const page=await context.newPage();await page.addInitScript(s=>{if(!localStorage.getItem('asterion-reach-save-v1'))localStorage.setItem('asterion-reach-save-v1',JSON.stringify(s));},s);await page.goto('http://127.0.0.1:5220');await page.waitForFunction(()=>window.__asterion);await page.waitForTimeout(150);return {page,context,state:s};}
const focus=page=>page.evaluate(()=>({tag:document.activeElement.tagName,text:document.activeElement.innerText?.slice(0,100),html:document.activeElement.outerHTML.slice(0,250)}));
{
 const {page,context}=await load('docs/default-campaign/actual/083-asterion-reach-cycle-50.json');
 await page.locator('.galaxy-system-label[data-system-id="s20"]').focus();
 const before=await focus(page);await page.keyboard.press('Enter');const after=await focus(page);await page.keyboard.press('Tab');const tab=await focus(page);
 results.mapKeyboard={before,after,tab,inspector:await page.locator('#inspector h2').innerText()};
 await page.screenshot({path:out+'/screens/map-selection-focus.png'});await context.close();
}
{
 const {page,context}=await load('docs/default-campaign/actual/083-asterion-reach-cycle-50.json');
 await page.locator('[data-page="empire"]').click();await page.locator('[data-action="colony-sort"][data-sort="science"]').click();
 await page.locator('[data-colony="s28"] [data-action="inspect"]').focus();await page.keyboard.press('Enter');
 results.colony={focusAfterInspect:await focus(page),viewAfterInspect:await page.evaluate(()=>window.__asterion.getPage()),name:await page.locator('#inspector h2').innerText()};
 await page.locator('[data-action="build-menu"][data-system="s28"]').click();
 await page.locator('#replace-building').selectOption('mine');
 await page.locator('[data-investment="shipyard"] summary').click();
 fs.writeFileSync(out+'/text/haven-shipyard-comparison.txt',await page.locator('.modal').innerText());
 await page.screenshot({path:out+'/screens/haven-shipyard-comparison.png'});
 await page.locator('[data-action="build"][data-item="shipyard"]').focus();await page.keyboard.press('Enter');
 results.colony.focusAfterBuild=await focus(page);results.colony.state=await page.evaluate(()=>{const s=window.__asterion.getState();return {turn:s.turn,orders:s.factions[0].orders,queue:s.systems.find(x=>x.id==='s28').queue};});
 await page.keyboard.press('Tab');results.colony.tabAfterBuild=await focus(page);
 await page.locator('[data-page="empire"]').click();await page.locator('.network-section').scrollIntoViewIfNeeded();
 const scrollBefore=await page.locator('#workspace-page').evaluate(e=>e.scrollTop);
 await page.locator('#inspector [data-action="inspect"]').first().click();await page.locator('[data-page="empire"]').click();
 results.colony.returnNavigation={scrollBefore,scrollAfter:await page.locator('#workspace-page').evaluate(e=>e.scrollTop),sort:await page.locator('.colony-table th[aria-sort]').innerText()};
 await page.screenshot({path:out+'/screens/colony-return-top.png'});await context.close();
}
{
 const {page,context}=await load('docs/default-campaign/actual/083-asterion-reach-cycle-50.json');
 await page.locator('[data-page="research"]').click();await page.locator('[data-action="research"][data-tech="terraforming"]').focus();
 const before=await focus(page);await page.keyboard.press('Enter');const after=await focus(page);await page.keyboard.press('Tab');const tab=await focus(page);
 results.researchKeyboard={before,after,tab,research:await page.evaluate(()=>window.__asterion.getState().factions[0].research)};await context.close();
}
{
 const {page,context}=await load('docs/odyssey-playtest/actual/checkpoints/cycle50.json',390);
 await page.locator('[data-page="empire"]').click();
 const row=page.locator('[data-colony="s15"]');await row.scrollIntoViewIfNeeded();
 results.mobile={rowBox:await row.boundingBox(),worldBox:await row.locator('td').first().boundingBox(),inspectBox:await row.locator('button').boundingBox(),viewport:page.viewportSize(),scrollDimensions:await page.locator('.colony-scroll').evaluate(e=>({width:e.clientWidth,scrollWidth:e.scrollWidth,scrollLeft:e.scrollLeft})),fonts:await row.locator('td').evaluateAll(els=>els.map(e=>({text:e.innerText,size:getComputedStyle(e).fontSize})))};
 await page.screenshot({path:out+'/screens/mobile-colony-table-left.png'});
 await row.locator('button').focus();await page.keyboard.press('Enter');
 results.mobile.focusAfterInspect=await focus(page);results.mobile.view=await page.evaluate(()=>window.__asterion.getPage());
 await page.screenshot({path:out+'/screens/mobile-after-inspect.png',fullPage:true});await context.close();
}
{
 const {page,context}=await load('docs/odyssey-playtest/actual/checkpoints/cycle66.json');
 const before=await page.evaluate(()=>JSON.stringify(window.__asterion.getState()));
 await page.locator('[data-action="show-conclusion"]').click();fs.writeFileSync(out+'/text/odyssey66-conclusion.txt',await page.locator('.modal').innerText());await page.screenshot({path:out+'/screens/odyssey66-conclusion.png'});
 await page.locator('[data-action="conclusion-chronicle"]').click();await page.locator('[data-log-filter="combat"]').click();
 if(await page.locator('[data-action="combat-report"]').count()){
  await page.locator('[data-action="combat-report"]').first().click();fs.writeFileSync(out+'/text/odyssey66-battle.txt',await page.locator('.modal').innerText());await page.screenshot({path:out+'/screens/odyssey66-battle.png'});await page.keyboard.press('Escape');
 }
 results.ending={unchanged:before===await page.evaluate(()=>JSON.stringify(window.__asterion.getState())),winner:await page.evaluate(()=>window.__asterion.getState().winner)};await context.close();
}
fs.writeFileSync(out+'/task-results.json',JSON.stringify(results,null,2));await browser.close();
