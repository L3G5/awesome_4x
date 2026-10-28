/** Labeled counterfactual branch, not the recorded human play.
 * Start from its legitimate cycle20 export, cancel Choir trade normally,
 * then issue only End cycle while normal rivals act.
 * node reopen-trade.mjs --repo /path/to/awesome_4x
 */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import assert from 'node:assert/strict';import {createHash}from'node:crypto';
import {execFileSync}from'node:child_process';import{fileURLToPath,pathToFileURL}from'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(process.argv.includes('--repo')?process.argv[process.argv.indexOf('--repo')+1]:process.cwd());
const evidence=JSON.parse(fs.readFileSync(path.join(here,'results.json'))),input=fs.readFileSync(path.join(here,'actual-cycle20.json'));
const sha=b=>createHash('sha256').update(b).digest('hex');assert.equal(sha(input),evidence.inputSha256);
const archive=execFileSync('git',['archive',evidence.sourceRevision,'src','package.json'],{cwd:repo,maxBuffer:20_000_000});assert.equal(sha(archive),evidence.sourceArchiveSha256);
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'asterion-trade-reopen-'));execFileSync('tar',['-x','-C',scratch],{input:archive});
try{
 const game=await import(pathToFileURL(path.join(scratch,'src/game.js'))),diplomacy=await import(pathToFileURL(path.join(scratch,'src/diplomacy.js'))),state=JSON.parse(input),commands=[],rows=[];
 const player=()=>state.factions.find(f=>f.id==='player'),choir=()=>state.factions.find(f=>f.id==='choir');
 const sample=(label,firstLogId)=>rows.push({label,turn:state.turn,trade:player().relations.choir.trade,tradeEndsAt:player().relations.choir.tradeEndsAt||0,choirTrust:choir().relations.player.trust,choirGrievance:choir().relations.player.grievance||0,choirCredits:choir().credits,choirProposals:diplomacy.getDiplomaticIntent(state,'choir').filter(a=>a.targetId==='player'),bilateralLog:state.log.filter(e=>e.id>=firstLogId&&e.targetId==='choir').map(e=>({turn:e.turn,text:e.text}))});
 assert.ok(player().relations.choir.trade);sample('Actual exported initial state',state.nextLogId);
 const first=state.nextLogId,action={type:'diplomacy',targetId:'choir',stance:'endTrade'},answer=game.command(state,action);assert.ok(answer.ok,answer.message);commands.push({turn:state.turn,action,result:answer});sample('Counterfactual player gives cancellation notice',first);
 let closedAt=null,reopenedAt=null;
 for(let n=0;n<12&&!state.winner;n++){
  const before=state.turn,firstLog=state.nextLogId,answer=game.endTurn(state);assert.ok(answer.ok);assert.ok(game.validateSave(state));commands.push({turn:before,action:{type:'endTurn'},result:answer});sample('Only ordinary End cycle; no player treaty action',firstLog);
  if(closedAt===null&&!player().relations.choir.trade)closedAt=state.turn;
  if(closedAt!==null&&player().relations.choir.trade){reopenedAt=state.turn;break;}
 }
 assert.ok(closedAt!==null,'Treaty must close after notice');assert.ok(reopenedAt!==null,'Automatic reopening was not reproduced');
 const result={method:'Counterfactual ordinary-command branch from the legitimate actual cycle20 export. This cancellation was not performed in the human campaign. One player endTrade command, then only endTurn; no grants or state edits.',sourceRevision:evidence.sourceRevision,inputSha256:sha(input),scriptSha256:sha(fs.readFileSync(fileURLToPath(import.meta.url))),closedAt,reopenedAt,commands,rows,allStatesValid:true};
 fs.writeFileSync(path.join(here,'reopen-trade-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{fs.rmSync(scratch,{recursive:true,force:true});}
