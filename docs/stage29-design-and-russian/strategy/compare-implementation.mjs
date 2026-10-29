import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import * as changed from '/tmp/asterion-strategy-implementation/src/game.js';
const repo='/home/leg/projects/awesome_4x', pin='93a62961e994994d30c05240b17c39a418020473';
const out='/tmp/asterion-critique-strategy/implementation';fs.mkdirSync(out,{recursive:true});
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'asterion-motive-baseline-'));
const graph=new Map();
function collect(file){
 if(graph.has(file))return;
 const source=execFileSync('git',['show',`${pin}:${file}`],{cwd:repo,encoding:'utf8'});graph.set(file,source);
 for(const [,relative] of source.matchAll(/^(?:import|export)[^\n]*?\bfrom\s*['"]([^'"\n]+)['"]/gm))if(relative.startsWith('.'))collect(path.posix.normalize(path.posix.join(path.posix.dirname(file),relative)));
}
collect('src/game.js');
for(const [file,source]of graph){const p=path.join(scratch,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,source);}
fs.writeFileSync(path.join(scratch,'package.json'),'{"type":"module"}\n');
const baseline=await import(pathToFileURL(path.join(scratch,'src/game.js')));
const read=p=>JSON.parse(fs.readFileSync(path.join(repo,p)));
const apply=(engine,state,action)=>action.type==='endTurn'?engine.endTurn(state):engine.command(state,action);
const sentence=' Competition over public Asterion alignment prompted this declaration.';
function normalized(value){
 if(typeof value==='string')return value.replace(sentence,'');
 if(Array.isArray(value))return value.map(normalized);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='warCause').map(([key,child])=>[key,normalized(child)]));
 return value;
}
const results=[];
try{
 for(const campaign of [
  {name:'default actual continuation',initial:'docs/default-campaign/actual/input-actual-cycle12-v0.21.0.json',commands:'docs/default-campaign/replay/final/commands.json',final:'docs/default-campaign/actual/109-asterion-reach-cycle-60.json'},
  {name:'Odyssey actual transcript',seed:'ASTERION-ODYSSEY-20',commands:'docs/odyssey-playtest/replay/commands.json',final:'docs/odyssey-playtest/actual/checkpoints/cycle66.json'}
 ]){
  const old=campaign.initial?read(campaign.initial):baseline.createGame(campaign.seed);
  const now=structuredClone(old),commands=read(campaign.commands);let checked=0,reloadChecks=0;
  for(const row of commands){
   const reloaded=JSON.parse(JSON.stringify(now));
   const oldResult=apply(baseline,old,row.action),newResult=apply(changed,now,row.action),reloadedResult=apply(changed,reloaded,row.action);
   assert.equal(oldResult.ok,true);assert.equal(newResult.ok,true);
   assert.deepEqual(normalized(newResult),oldResult,`${campaign.name}: result${checked}`);
   assert.deepEqual(normalized(now),old,`${campaign.name}: state${checked}`);
   assert.deepEqual(newResult,reloadedResult);assert.deepEqual(now,reloaded);reloadChecks++;
   assert.equal(changed.validateSave(now),true);checked++;
   if(campaign.initial&&row.action.type==='endTurn'&&[53,55].includes(now.turn))fs.writeFileSync(path.join(out,`replay-derived-cycle${now.turn}.json`),JSON.stringify(now,null,2)+'\n');
  }
  assert.deepEqual(old,read(campaign.final),'baseline still matches historical actual export');
  results.push({campaign:campaign.name,commands:checked,allPostCommandMechanicalStatesEqual:true,allCommandResultsEqualAfterAuthoredTextNormalization:true,jsonReloadNextCommandChecks:reloadChecks,baselineExactActualExport:true,turn:now.turn,winner:now.winner,alignedCauseDeclarations:now.log.filter(e=>e.text.includes(sentence.trim())).map(e=>({turn:e.turn,text:e.text})),finalRng:now.rng});
 }
 const report={baseline:pin,method:'Paired ordinary-command application of existing actual UI histories to pinned baseline and changed engine. No new campaign, synthetic balance sample or altered player strategy.',normalizations:['Remove only relations warCause metadata.','Remove only the exact appended authored declaration sentence from strings; do not ignore or reorder any other log, briefing, AI, fleet, economy, RNG or state field.'],results};
 fs.writeFileSync(path.join(out,'mechanical-comparison.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{fs.rmSync(scratch,{recursive:true,force:true});}
