import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createGame, validateSave } from '../../../src/game.js';
import { TurnHistory, applyTurnCommand } from '../../../src/turn-history.js';
const [baseURL,commit]=process.argv.slice(2);
if(!baseURL||!commit)throw Error('Pass the supplied immutable candidate URL and committed source pin.');
const out=new URL('./',import.meta.url),root=new URL('../../../',import.meta.url),hash=value=>createHash('sha256').update(value).digest('hex');
const original=createGame('ASTERION'),id=original.fleets.find(f=>f.owner==='player'&&f.type==='scout').id,history=new TurnHistory(validateSave);
const held=applyTurnCommand(original,{type:'hold',fleetId:id},history).state;
const returned=applyTurnCommand(held,{type:'resume',fleetId:id},history).state;
assert.deepEqual(returned,original);const serialized=history.serialize(returned);
const htmlResponse=await fetch(baseURL),html=await htmlResponse.text(),assets=[];assert.equal(htmlResponse.status,200);
for(const match of html.matchAll(/(?:src|href)="([^"\s]+\.(?:js|css))"/g)){const response=await fetch(new URL(match[1],baseURL));assert.equal(response.status,200);assets.push({path:match[1],sha256:hash(Buffer.from(await response.arrayBuffer()))});}
const browser=await chromium.launch({executablePath:'/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',args:['--enable-unsafe-swiftshader']});const results=[],errors=[];
try{for(const kind of['absent','malformed','valid']){const context=await browser.newContext({viewport:{width:1280,height:960}}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(({kind,serialized,original})=>{localStorage.setItem('asterion-reach-undo-v1',serialized);if(kind!=='absent')localStorage.setItem('asterion-reach-save-v1',kind==='malformed'?'{':JSON.stringify(original));},{kind,serialized,original});await page.goto(baseURL);await page.locator('#undo-action').waitFor();const enabled=await page.locator('#undo-action').isEnabled();assert.equal(enabled,kind==='valid');const welcome=await page.locator('.modal.welcome').count();assert.equal(welcome,kind==='valid'?0:1);if(kind==='valid'){await page.locator('#undo-action').click();assert.deepEqual(await page.evaluate(()=>window.__asterion.getState()),held);await page.locator('#undo-action').click();assert.deepEqual(await page.evaluate(()=>window.__asterion.getState()),original);assert.equal(await page.locator('#undo-action').isDisabled(),true);}else{assert.equal(await page.locator('.modal [data-action="undo"]').count(),0);await page.locator('.modal').screenshot({path:new URL(`correction-${kind}-save-welcome.png`,out).pathname});}results.push({canonicalSave:kind,undoInitiallyEnabled:enabled,newWelcomeShown:welcome===1,orphanHistoryRejected:kind==='valid'?null:!enabled,validHistoryRetainedAndUnwindsExactly:kind==='valid'?true:null});await context.close();}}finally{await browser.close();}
assert.deepEqual(errors,[]);
const paths=['src/main.js','src/turn-history.js','src/undo.css','src/style.css','src/mobile-inspection.css','src/localization.css','src/localization.js','src/locales/ru.js','src/locales/bindings.js','src/locales/slot-overrides.json','src/game.js','src/galaxy.js','tests/turn-history.test.js','tests/undo-ui.spec.js'];
writeFileSync(new URL('correction-results.json',out),JSON.stringify({candidate:{commit,baseURL,htmlSha256:hash(html),assets,sourceSha256:Object.fromEntries(paths.map(path=>[path,hash(execFileSync('git',['show',`${commit}:${path}`],{cwd:root}))]))},pageErrors:errors,results},null,2)+'\n');
console.log(JSON.stringify({cases:results.length,pageErrors:errors.length,allAssertionsPassed:true}));
