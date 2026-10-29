/** Derived replay of the two completed ordinary UI prefixes; not additional play. */
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {fileURLToPath,pathToFileURL}from'node:url';import{execFileSync}from'node:child_process';
const here=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(here,'../../..'),pin='a7c955dd83e35ee98346f7877c11339d52de9ba5';
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'asterion-map-ui-replay-'));
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const cases=[
 {seed:'stage30-map-16',checkpoint:'a-actual-cycle6.json',commands:[
 [4,{type:'move',fleetId:'f1',targetId:'s38'}],[4,{type:'move',fleetId:'f1',targetId:'s18'}],[5,{type:'research',techId:'ecology'}],[6,{type:'anomaly',systemId:'s18',choiceId:'reactor'}],[6,{type:'move',fleetId:'f2',targetId:'s38'}],[6,{type:'colonize',fleetId:'f2'}],[8,{type:'build',systemId:'s0',itemId:'colony'}],[8,{type:'hold',fleetId:'f3'}],[8,{type:'endTurn'}],[9,{type:'hold',fleetId:'f1'}],[9,{type:'build',systemId:'s38',itemId:'lab'}],[9,{type:'endTurn'}],[10,{type:'endTurn'}],[11,{type:'research',techId:'physics'}],[11,{type:'endTurn'}],[11,{type:'endTurn'}],[12,{type:'move',fleetId:'f13',targetId:'s28'}],[12,{type:'colonize',fleetId:'f13'}],[12,{type:'build',systemId:'s28',itemId:'mine'}],[12,{type:'build',systemId:'s0',itemId:'lab'}]
 ]},
 {seed:'stage30-map-12',checkpoint:'b-actual-cycle9.json',commands:[
 [16,{type:'move',fleetId:'f1',targetId:'s19'}],[17,{type:'research',techId:'physics'}],[18,{type:'anomaly',systemId:'s19',choiceId:'salvage'}],[19,{type:'hold',fleetId:'f1'}],[19,{type:'move',fleetId:'f2',targetId:'s8'}],[19,{type:'colonize',fleetId:'f2'}],[19,{type:'build',systemId:'s8',itemId:'mine'}],[19,{type:'build',systemId:'s0',itemId:'lab'}],[19,{type:'hold',fleetId:'f3'}],[19,{type:'endTurn'}],[20,{type:'endTurn'}],[20,{type:'endTurn'}],[21,{type:'endTurn'}],[22,{type:'build',systemId:'s0',itemId:'colony'}],[22,{type:'endTurn'}],[23,{type:'diplomacy',targetId:'veyr',stance:'declineTrade'}],[23,{type:'endTurn'}],[24,{type:'research',techId:'logistics'}],[24,{type:'endTurn'}],[25,{type:'endTurn'}],[26,{type:'move',fleetId:'f16',targetId:'s33'}],[26,{type:'colonize',fleetId:'f16'}],[26,{type:'build',systemId:'s33',itemId:'lab'}]
 ]}
];
try{
 const files=new Map();function collect(file){if(files.has(file))return;const source=execFileSync('git',['show',`${pin}:${file}`],{cwd:repo,encoding:'utf8'});files.set(file,source);for(const[,rel]of source.matchAll(/^(?:import|export)[^\n]*?\bfrom\s*['"]([^'"\n]+)['"]/gm))if(rel.startsWith('.'))collect(path.posix.normalize(path.posix.join(path.posix.dirname(file),rel)));}collect('src/game.js');
 for(const[file,source]of files){const target=path.join(scratch,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,source);}fs.writeFileSync(path.join(scratch,'package.json'),'{"type":"module"}\n');
 const engine=await import(pathToFileURL(path.join(scratch,'src/game.js'))),reports=[];
 for(const item of cases){
  const state=engine.createGame(item.seed),commands=[];let reloadChecks=0;
  for(const[uiRequest,action]of item.commands){const turnBefore=state.turn,reloaded=JSON.parse(JSON.stringify(state));const result=engine.command(state,action),reloadResult=engine.command(reloaded,action);assert.equal(result.ok,true);assert.deepEqual(result,reloadResult);assert.deepEqual(state,reloaded);assert.equal(engine.validateSave(state),true);reloadChecks++;commands.push({uiRequest,turnBefore,action,result});}
  const raw=fs.readFileSync(path.join(here,'ui',item.checkpoint)),actual=JSON.parse(raw);assert.deepEqual(state,actual,'full actual checkpoint mismatch '+item.seed);
  reports.push({seed:item.seed,commands:commands.length,endTurns:commands.filter(c=>c.action.type==='endTurn').length,reloadChecks,allStatesValid:true,fullActualCheckpointEqual:true,actualFile:item.checkpoint,actualFileSha256:sha(raw),canonicalStateSha256:sha(JSON.stringify(state)),turn:state.turn,own:engine.getEmpireStats(state),techs:state.factions[0].techs});item.commands=commands;
 }
 fs.writeFileSync(path.join(here,'ui/normalized-commands.json'),JSON.stringify({pin,method:'Derived from successful actual UI receipts only. Failed batch tails are excluded. Optional opaque offerId is omitted for the unique Veyr incoming trade decline, using the normal target lookup; the actual UI receipt identifies Veyr. Fleet f16 is present in the actual cycle9 visible roster observation.',cases},null,2)+'\n');
 const result={pin,method:'Post-session exact engine reconstruction of the two existing UI prefixes. No game commands or hidden state reads were used during UI play. This replay is not another playthrough or evidence of optimal strategy.',engineHashes:Object.fromEntries([...files].map(([file,source])=>[file,sha(source)])),reports};fs.writeFileSync(path.join(here,'ui/replay-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(reports,null,2));
}finally{fs.rmSync(scratch,{recursive:true,force:true});}
