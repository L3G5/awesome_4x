/** Fixed 24-campaign lifecycle cohort; all player choices use normal commands.
 * node audit.mjs --repo /path/to/awesome_4x --output /tmp/stage12-lifecycle.json
 * Uses pinned original source, with no instrumentation or source modifications.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const arg=(key,fallback)=>process.argv.includes(key)?process.argv[process.argv.indexOf(key)+1]:fallback;
const repo=path.resolve(arg('--repo',process.cwd()));
const output=path.resolve(arg('--output',path.join(os.tmpdir(),'asterion-stage12-lifecycle-results.json')));
const revision='123cee1a4e2b8175713468b2d8d9c3fc0d5787cf';
const seeds=['ASTERION',...Array.from({length:7},(_,i)=>`stage4-audit-${i+1}`)];
const policies=['ignore','accept','decline'];
const checkpointTurns=[20,40,60,80,100];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const jsonClone=value=>JSON.parse(JSON.stringify(value));
const archive=execFileSync('git',['archive',revision,'src','package.json'],{cwd:repo,maxBuffer:20_000_000});
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'asterion-trade-lifecycle-'));
execFileSync('tar',['-x','-C',scratch],{input:archive});
const graph=new Set();
function collect(file){
  if(graph.has(file))return;graph.add(file);
  for(const match of fs.readFileSync(path.join(scratch,file),'utf8').matchAll(/^\s*(?:import\s+(?:[^;]*?\s+from\s+)?|export\s+(?:\{[^;]*?\}|\*)\s+from\s+)['"]([^'"]+)['"]/gm))collect(path.posix.normalize(path.posix.join(path.posix.dirname(file),match[1])));
}
collect('src/game.js');
const engineHashes=Object.fromEntries([...graph].map(file=>[file,sha(fs.readFileSync(path.join(scratch,file)))]));
const game=await import(pathToFileURL(path.join(scratch,'src/game.js')));
const diplomacy=await import(pathToFileURL(path.join(scratch,'src/diplomacy.js')));
const faction=(state,id='player')=>state.factions.find(f=>f.id===id);
const rivals=['veyr','khar','choir'];
const incoming=state=>diplomacy.getActiveDiplomacyOffers(state).filter(o=>o.to==='player'&&o.kind==='trade').sort((a,b)=>a.createdTurn-b.createdTurn||Number(a.id.slice(6))-Number(b.id.slice(6))||a.from.localeCompare(b.from));
function policyActions(state,policy,execute){
  if(policy==='ignore')return;
  const stance=policy==='accept'?'acceptTrade':'declineTrade';
  for(const offer of incoming(state))if(diplomacy.getDiplomacyForecast(state,'player',offer.from).actions[stance].enabled)execute({type:'diplomacy',targetId:offer.from,stance,offerId:offer.id});
}
function plainRound(state,policy){
  const results=[];
  policyActions(state,policy,action=>results.push(game.command(state,action)));
  results.push(game.endTurn(state));return results;
}
const freshCounts=()=>({created:0,accepted:0,declined:0,expired:0,terminalPending:0,expiryAtDeadline:0,earlyInvalidation:0,quietDeadlineChanges:0,closedTreaties:0,openedTreaties:0});
const sum=(rows,key)=>rows.reduce((n,row)=>n+(row[key]||0),0);
const distribution=values=>{const v=[...values].sort((a,b)=>a-b);return{count:v.length,min:v[0]??null,median:v.length?(v[Math.floor((v.length-1)/2)]+v[Math.floor(v.length/2)])/2:null,max:v.at(-1)??null};};
const result={generatedAt:new Date().toISOString(),sourceRevision:revision,sourceArchiveSha256:sha(archive),engineHashes,scriptSha256:sha(fs.readFileSync(fileURLToPath(import.meta.url))),seeds,policies:{ignore:'Never respond to incoming trade; all other player decisions also remain passive.',accept:'Before End cycle, accept each legal active incoming trade offer using its normal command; make no other player choices.',decline:'Before End cycle, decline each legal active incoming trade offer using its normal command; make no other player choices.'},method:{cohort:'Eight identical seeds per policy;24 campaigns total. Source is pinned and unmodified. No older-engine or balance comparator.',termination:'First winner or LAST_TURN120; no extra campaigns.',decisionOrder:'Incoming trade sorted by createdTurn, numeric offer ID, then proposer ID. Re-query legal response before each command. Offers without a legal response remain pending.',checkpoints:checkpointTurns,reload:'At each reached checkpoint, execute the full next policy round from structuredClone and JSON.parse(JSON.stringify(state)); compare command results and complete serialized states. Probes are excluded from cohort event/cycle totals.',checks:'Validate every initial/post-command/post-End-cycle state, finite nonnegative faction credits/minerals/science/orders, bilateral treaty flags, explicit accepted-offer authorization for every player treaty opening, immutable offer terms, no lost pending receipts, no second resolution, no post before a prior quiet deadline, valid quiet-phase forecasts and AI intents.',financialMeasurement:'Accept/decline commands check actual recipient/proposer credit deltas and order cost. Campaign expiry totals are30-credit refund obligations derived from resolved offer receipts, not isolated treasury deltas: AI spending and income share the same End-cycle operation. No engine instrumentation or synthetic counterfactual is used.',denominators:'Offer counts are distinct trade offer IDs within each campaign, including finalized records later pruned from the bounded save archive. A treaty observation is one player-rival pair after a main-cohort state check. Quiet observations count pair states whose deadline is still future. Resource checks count four fields for all four factions per checked state.',limits:'These are intentionally passive policy measurements, not human difficulty/win rates or an earlier-version balance comparison. Neither policy initiates or cancels treaties, moves ships, develops colonies, researches, declares war, responds to peace, or uses Hold. Completed games can retain pending escrow; this is reported, not treated as an invented refund. Eight matched seeds do not estimate a population win probability.'},runs:[],failures:[]};
const totalChecks={states:0,resourceValues:0,treatyObservations:0,quietObservations:0,creationDeadlineChecks:0,receiptChecks:0,resolutionChecks:0,actualResponseFinanceChecks:0,reloadRounds:0,reloadStates:0,unauthorizedOpenings:0,invalidStates:0,negativeOrNonfiniteValues:0};
const started=Date.now();
try{
  for(const policy of policies)for(const seed of seeds){
    const state=game.createGame(seed),ledger=new Map(),pruned=new Set(),responded=new Set(),consent=new Map(rivals.map(id=>[id,null]));
    const counters=freshCounts(),byFaction=Object.fromEntries(rivals.map(id=>[id,freshCounts()]));
    const commandHash=createHash('sha256'),checks={states:0,quietObservations:0,receiptChecks:0,reloadRounds:0};
    const row={policy,seed,status:'running',startTurn:state.turn,counters,byFaction,checks,endTurnCalls:0,turnAdvances:0,responseCommands:0,peakSavedOfferRecords:0,peakPendingTradeOffers:0,prunedFinalizedTradeRecords:0,firstOfferTurn:null,firstAcceptanceTurn:null,firstDeadlineTurn:null};
    let previous=new Map(),previousTrades=new Map(rivals.map(id=>[id,false])),previousDeadlines=new Map(rivals.map(id=>[id,0]));
    function check(afterAction=null,beforeTurn=state.turn){
      assert.ok(game.validateSave(state),`${seed}/${policy}/turn${state.turn}: invalid save`);totalChecks.states++;checks.states++;
      for(const f of state.factions)for(const field of ['credits','minerals','science','orders']){assert.ok(Number.isFinite(f[field])&&f[field]>=0,`${f.id}.${field}: invalid balance`);totalChecks.resourceValues++;}
      const tradeOffers=(state.diplomacyOffers||[]).filter(o=>o.kind==='trade'),present=new Map(tradeOffers.map(o=>[o.id,o]));
      row.peakSavedOfferRecords=Math.max(row.peakSavedOfferRecords,state.diplomacyOffers?.length||0);
      row.peakPendingTradeOffers=Math.max(row.peakPendingTradeOffers,tradeOffers.filter(o=>o.status==='pending').length);
      for(const [id,old]of previous)if(!present.has(id)){assert.notEqual(old.status,'pending','A pending escrow receipt disappeared');pruned.add(id);}
      for(const offer of tradeOffers){
        assert.equal(offer.to,'player');assert.ok(rivals.includes(offer.from));assert.equal(offer.credits,30);
        const terms={id:offer.id,kind:offer.kind,from:offer.from,to:offer.to,createdTurn:offer.createdTurn,expiresTurn:offer.expiresTurn,credits:offer.credits};
        let saved=ledger.get(offer.id);
        if(!saved){
          assert.ok(!pruned.has(offer.id),'A removed finalized ID was reused');
          assert.ok(offer.createdTurn>=(previousDeadlines.get(offer.from)||0),'A proposal bypassed an existing quiet deadline');totalChecks.creationDeadlineChecks++;
          saved={terms,status:'pending'};ledger.set(offer.id,saved);counters.created++;byFaction[offer.from].created++;
          row.firstOfferTurn??=offer.createdTurn;
        }else{assert.deepEqual(terms,saved.terms,'A stored offer changed its funded terms');totalChecks.receiptChecks++;checks.receiptChecks++;}
        if(saved.status!==offer.status){
          assert.equal(saved.status,'pending','An offer was resolved more than once');
          assert.ok(['accepted','declined','expired'].includes(offer.status));
          if(offer.status==='accepted'||offer.status==='declined')assert.ok(responded.has(offer.id),'Offer resolved without a tracked player response');
          counters[offer.status]++;byFaction[offer.from][offer.status]++;totalChecks.resolutionChecks++;
          if(offer.status==='expired'){
            const deadline=faction(state,offer.from).relations.player.tradeOfferAfter;
            const expiryReached=state.turn>=offer.expiresTurn;
            if(expiryReached){assert.ok(deadline>=offer.expiresTurn+5);counters.expiryAtDeadline++;byFaction[offer.from].expiryAtDeadline++;}
            else{assert.ok(deadline>=beforeTurn+5&&deadline<=state.turn+5);counters.earlyInvalidation++;byFaction[offer.from].earlyInvalidation++;}
          }
          saved.status=offer.status;
        }
      }
      for(const id of rivals){
        const relation=faction(state).relations[id],reverse=faction(state,id).relations.player,trade=relation.trade,deadline=reverse.tradeOfferAfter||0;
        totalChecks.treatyObservations++;assert.equal(trade,reverse.trade,'Asymmetric player trade flags');
        if(trade&&!previousTrades.get(id)){
          assert.ok(afterAction?.stance==='acceptTrade'&&afterAction.targetId===id&&responded.has(afterAction.offerId),'Player trade opened without an explicit acceptance in this step');
          consent.set(id,afterAction.offerId);counters.openedTreaties++;byFaction[id].openedTreaties++;row.firstAcceptanceTurn??=state.turn;
        }
        if(!trade&&previousTrades.get(id)){consent.set(id,null);counters.closedTreaties++;byFaction[id].closedTreaties++;}
        if(trade)assert.ok(consent.get(id),'An open treaty has no tracked player authorization');
        if(policy!=='accept')assert.equal(trade,false,'A non-accepting policy gained trade access');
        if(deadline!==previousDeadlines.get(id)){assert.ok(deadline>=previousDeadlines.get(id),'Quiet deadline went backwards');counters.quietDeadlineChanges++;byFaction[id].quietDeadlineChanges++;row.firstDeadlineTurn??=state.turn;}
        if(deadline>state.turn){
          checks.quietObservations++;totalChecks.quietObservations++;
          assert.equal(diplomacy.getDiplomacyForecast(state,id,'player').trade.enabled,false,'Trade forecast bypasses quiet interval');
          assert.ok(!diplomacy.getDiplomaticIntent(state,id).some(a=>a.targetId==='player'&&a.stance==='trade'),'AI proposes during its quiet interval');
        }
        previousTrades.set(id,trade);previousDeadlines.set(id,deadline);
      }
      previous=new Map(tradeOffers.map(o=>[o.id,{status:o.status}]));
    }
    function execute(action){
      const proposer=faction(state,action.targetId),player=faction(state),credits=player.credits,senderCredits=proposer.credits,orders=player.orders,beforeTurn=state.turn;
      const answer=game.command(state,action);assert.ok(answer.ok,answer.message);
      responded.add(action.offerId);row.responseCommands++;totalChecks.actualResponseFinanceChecks++;
      assert.equal(player.credits,credits,'Response charged or paid recipient credits');assert.equal(player.orders,orders-1);
      assert.equal(proposer.credits,senderCredits+(action.stance==='declineTrade'?30:0),'Incorrect actual response escrow debit/refund');
      if(action.stance==='declineTrade')assert.equal(proposer.relations.player.tradeOfferAfter,state.turn+5);
      commandHash.update(JSON.stringify({turn:beforeTurn,action,result:answer})+'\n');check(action,beforeTurn);
    }
    try{
      check();
      while(!state.winner&&state.turn<game.LAST_TURN){
        if(checkpointTurns.includes(state.turn)){
          const direct=structuredClone(state),reloaded=jsonClone(state),a=plainRound(direct,policy),b=plainRound(reloaded,policy);
          assert.deepEqual(a,b);assert.equal(JSON.stringify(direct),JSON.stringify(reloaded),'JSON reload changed the complete next policy round');
          assert.ok(game.validateSave(direct));assert.ok(game.validateSave(reloaded));
          checks.reloadRounds++;totalChecks.reloadRounds++;totalChecks.reloadStates+=2;
        }
        policyActions(state,policy,execute);
        const beforeTurn=state.turn,answer=game.endTurn(state);assert.ok(answer.ok,answer.message);
        row.endTurnCalls++;row.turnAdvances+=state.turn-beforeTurn;
        commandHash.update(JSON.stringify({turn:beforeTurn,action:{type:'endTurn'},result:answer})+'\n');check(null,beforeTurn);
        assert.ok(state.turn>beforeTurn||state.winner,'End cycle failed to advance or conclude');
      }
      assert.ok(state.winner,'Campaign reached the bound without a winner');
      for(const saved of ledger.values())if(saved.status==='pending'){counters.terminalPending++;byFaction[saved.terms.from].terminalPending++;}
      assert.equal(counters.created,counters.accepted+counters.declined+counters.expired+counters.terminalPending);
      assert.equal(counters.accepted+counters.declined,row.responseCommands);
      assert.equal(counters.openedTreaties,counters.accepted);
      Object.assign(row,{status:'pass',endTurn:state.turn,winner:state.winner,victoryType:state.victoryType,prunedFinalizedTradeRecords:pruned.size,finalActiveTradePartners:rivals.filter(id=>faction(state).relations[id].trade),finalQuietDeadlines:Object.fromEntries(rivals.map(id=>[id,faction(state,id).relations.player.tradeOfferAfter||0])),escrowReceipts:{reservedCredits:counters.created*30,consumedFees:counters.accepted*30,refundedCredits:(counters.declined+counters.expired)*30,terminalOutstandingCredits:counters.terminalPending*30},commandTraceSha256:commandHash.digest('hex'),finalStateSha256:sha(JSON.stringify(state))});
    }catch(error){row.status='fail';row.error=error.message;result.failures.push({seed,policy,turn:state.turn,error:error.stack});}
    result.runs.push(row);console.log(`${policy}/${seed}: ${row.status} turn${row.endTurn??state.turn} offers${counters.created} accept${counters.accepted} decline${counters.declined} expire${counters.expired}`);
    if(result.failures.length)break;
  }
  const summaries={};
  for(const policy of policies){const runs=result.runs.filter(r=>r.policy===policy);summaries[policy]={campaigns:runs.length,passed:runs.filter(r=>r.status==='pass').length,finishTurn:distribution(runs.filter(r=>r.status==='pass').map(r=>r.endTurn)),winners:Object.fromEntries(rivals.concat('player').map(id=>[id,runs.filter(r=>r.winner===id).length])),endTurnCalls:sum(runs,'endTurnCalls'),responses:sum(runs,'responseCommands'),tradeOffers:Object.fromEntries(Object.keys(freshCounts()).map(key=>[key,runs.reduce((n,r)=>n+r.counters[key],0)])),prunedFinalizedTradeRecords:sum(runs,'prunedFinalizedTradeRecords'),peakSavedOfferRecords:Math.max(0,...runs.map(r=>r.peakSavedOfferRecords)),firstOfferTurn:distribution(runs.filter(r=>r.firstOfferTurn!==null).map(r=>r.firstOfferTurn)),escrowReceipts:Object.fromEntries(['reservedCredits','consumedFees','refundedCredits','terminalOutstandingCredits'].map(key=>[key,runs.reduce((n,r)=>n+(r.escrowReceipts?.[key]||0),0)]))};}
  result.summary={campaigns:result.runs.length,passed:result.runs.filter(r=>r.status==='pass').length,endTurnCalls:sum(result.runs,'endTurnCalls'),turnAdvances:sum(result.runs,'turnAdvances'),checks:totalChecks,byPolicy:summaries,elapsedSeconds:Number(((Date.now()-started)/1000).toFixed(3))};
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result.summary,null,2));
  if(result.failures.length)process.exitCode=1;
}finally{fs.rmSync(scratch,{recursive:true,force:true});}
