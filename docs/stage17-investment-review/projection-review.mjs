import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
const repo=path.resolve(process.argv[2]||'/tmp/asterion-stage17-investment'),out=path.dirname(fileURLToPath(import.meta.url));
const {createGame,command,getSystemYield,getEmpireStats,validateSave}=await import(pathToFileURL(path.join(repo,'src/game.js')));
const {TECHS}=await import(pathToFileURL(path.join(repo,'src/content.js')));
const {getInvestmentComparison:compare}=await import(pathToFileURL(path.join(repo,'src/investment.js')));
const clone=s=>structuredClone(s),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const checks=[];const run=(name,fn)=>{const extra=fn()||{};checks.push({name,passed:true,...extra});};
function fixture(factionId='player'){
 const s=createGame('independent-investment-comparison'),f=s.factions.find(f=>f.id===factionId),w=s.systems.find(w=>w.owner===factionId);
 s.lanes=[];Object.assign(f,{credits:2000,minerals:2000,orders:18,techs:Object.keys(TECHS),research:null});
 Object.assign(w,{population:8,habitability:75,growth:0,buildings:['mine','factory','shipyard'],queue:null,charter:{type:'forge',level:1}});
 assert(validateSave(s));return{s,f,w};
}
const building=(id,replaceBuildingId)=>({kind:'building',itemId:id,...(replaceBuildingId?{replaceBuildingId}:{})});
const forge={kind:'charter',charterType:'forge'};
const throughput=(view,id)=>view.throughput.find(row=>row.id===id);

run('Forge threshold separates five-cycle investment from two-to-one-cycle frigate throughput',()=>{
 const {s,w}=fixture(),before=JSON.stringify(s),v=compare(s,w.id,forge);
 assert(v.comparable);assert.deepEqual(v.project.cost,{credits:300,minerals:100});
 assert.equal(v.construction.production,24);assert.equal(v.construction.cyclesAtCurrentRate,5);
 assert.equal(v.before.colony.production,24);assert.equal(v.after.colony.production,30);
 assert.equal(throughput(v,'frigate').before.cycles,2);assert.equal(throughput(v,'frigate').after.cycles,1);
 assert.equal(throughput(v,'frigate').before.cost.minerals,32);assert.equal(throughput(v,'frigate').after.cost.minerals,28);
 assert.equal(v.before.repair.capacity,10);assert.equal(v.after.repair.capacity,12);
 assert.equal(JSON.stringify(s),before);
});

run('Funds, orders and paid queue block commissioning without blocking structural comparison or leaking planning funds',()=>{
 const {s,f,w}=fixture();f.credits=0;f.minerals=0;f.orders=0;
 w.queue={kind:'ship',itemId:'frigate',cost:{credits:25,minerals:32},work:26,progress:5};
 const before=JSON.stringify(s),v=compare(s,w.id,forge);
 assert(v.comparable);assert(!v.project.commission.enabled);assert.match(v.project.commission.reason,/No orders/);
 assert(v.construction.queueBusy);assert.equal(v.after.colony.production,30);
 assert(!Object.hasOwn(v.after.empire,'credits'));assert(!Object.hasOwn(v.after.empire,'minerals'));
 assert.equal(JSON.stringify(s),before);
 const ended=clone(s);ended.winner='player';assert.match(compare(ended,w.id,forge).project.commission.reason,/campaign has ended/i);
 const fallen=clone(s);fallen.factions[0].eliminated=true;assert.match(compare(fallen,w.id,forge).project.commission.reason,/no longer active/i);
});

run('Missing technology, absent support and full slots cannot invent completed outcomes',()=>{
 const {s,f,w}=fixture();f.techs=f.techs.filter(id=>id!=='industry');
 const locked=compare(s,w.id,forge);assert.equal(locked.comparable,false);assert.equal(locked.after,null);assert.equal(locked.delta,null);
 f.techs.push('industry');w.buildings=w.buildings.filter(id=>id!=='factory');delete w.charter;
 const unsupported=compare(s,w.id,forge);assert.equal(unsupported.comparable,false);assert.equal(unsupported.after,null);
 w.buildings=['mine','factory','shipyard','lab'];const full=compare(s,w.id,building('market'));
 assert.equal(full.comparable,false);assert.equal(full.after,null);
});

run('Removing Extractor includes the full dependent Extraction charter loss',()=>{
 const {s,w}=fixture();w.charter={type:'extraction',level:1};const v=compare(s,w.id,building('market','mine'));
 assert(v.comparable);assert.equal(v.delta.colony.minerals,-5-(2+w.richness));assert.equal(v.delta.colony.credits,7);
 assert.equal(v.removed.building.id,'mine');assert.equal(v.removed.charter.type,'extraction');assert.equal(v.after.infrastructure.used,w.buildings.length);
});

run('Removing a shipyard yields unavailable ship comparisons and a reduced repair pool',()=>{
 const {s,w}=fixture(),v=compare(s,w.id,building('market','shipyard'));
 assert(v.comparable);assert.equal(v.before.repair.capacity,10);assert.equal(v.after.repair.capacity,6);
 for(const row of v.throughput.filter(row=>row.kind==='ship')){assert(row.before.available);assert.equal(row.after.available,false);assert.equal(row.after.cycles,null);assert.match(row.after.reason,/Shipyard/i);}
});

run('Removing Forge support removes factory production, charter production, discount and charter repair together',()=>{
 const {s,w}=fixture(),v=compare(s,w.id,building('market','factory'));
 assert.equal(v.after.colony.production,12);assert.equal(v.delta.colony.production,-12);
 assert.equal(v.before.militaryDiscount,.1);assert.equal(v.after.militaryDiscount,0);
 assert.equal(v.after.repair.capacity,8);assert.equal(v.removed.charter.type,'forge');
 assert.equal(throughput(v,'frigate').after.cost.minerals,35);
});

run('Habitat removal preserves population and infrastructure capacity above the new growth limit',()=>{
 const {s,w}=fixture();delete w.charter;w.population=12;w.buildings=['mine','shipyard','habitat','lab'];
 const v=compare(s,w.id,building('factory','habitat'));
 assert.equal(v.before.colony.capacity,12);assert.equal(v.after.colony.capacity,8);assert.equal(v.after.colony.population,12);
 assert.equal(v.after.infrastructure.capacity,v.before.infrastructure.capacity);assert.equal(v.after.colony.growthPaused,true);
});

run('Current research, faction rounding, capped orders and damaged-colony defense use actual yield rules',()=>{
 const {s,w}=fixture();const lab=compare(s,w.id,building('lab'));assert.equal(lab.delta.colony.science,9);
 w.defenseDamage=10;const bastion=compare(s,w.id,building('bastion'));assert.equal(bastion.delta.colony.defense,30);
 const other=fixture('veyr');const market=compare(other.s,other.w.id,building('market'),'veyr');assert.equal(market.delta.colony.credits,7);assert.equal(market.delta.empire.creditIncome,9);
 for(const colony of s.systems.slice(4,13)){Object.assign(colony,{owner:'player',population:1,buildings:[],queue:null});delete colony.charter;}
 const forum=compare(s,w.id,building('forum'));assert.equal(forum.before.empire.maxOrders,18);assert.equal(forum.after.empire.maxOrders,18);assert.equal(forum.delta.empire.maxOrders,0);assert.equal(forum.delta.empire.uncappedOrders,1);
});

run('Local visible blockade is separate from nominal repair; hidden rival fleets/economies do not affect the projection',()=>{
 const {s,w}=fixture(),baseline=compare(s,w.id,forge),changed=clone(s);
 for(const faction of changed.factions.filter(f=>f.id!=='player')){faction.credits+=5000;faction.minerals+=3000;faction.techs=Object.keys(TECHS);}
 for(const fleet of changed.fleets.filter(f=>f.owner!=='player')){fleet.ships*=3;fleet.hp*=3;fleet.systemId='s41';}
 assert.deepEqual(compare(changed,w.id,forge),baseline);
 const local=s.fleets.find(f=>f.owner==='khar'&&f.type==='frigate');local.systemId=w.id;s.factions[0].relations.khar.status='war';s.factions.find(f=>f.id==='khar').relations.player.status='war';
 const blocked=compare(s,w.id,forge);assert.equal(blocked.before.repair.blocked,true);assert.equal(blocked.after.repair.blocked,true);assert.equal(blocked.after.repair.capacity,12);
 assert.equal(compare(s,'s1',forge),null);assert.equal(compare(s,'s0',forge,'missing'),null);
});

run('Ordinary Forge completion consumes five cycles at the old rate and agrees with the fixed-condition projection',()=>{
 const {s,w}=fixture(),v=compare(s,w.id,forge);assert(command(s,v.project.command).ok);
 const result=[];for(let cycle=1;w.queue;cycle++){assert(cycle<=5);assert(command(s,{type:'endTurn'}).ok);assert(validateSave(s));result.push({cycle,production:getSystemYield(s,w).production,progress:w.queue?.progress??null});}
 assert.deepEqual(result.map(r=>r.production),[24,24,24,24,30]);assert.equal(result.length,v.construction.cyclesAtCurrentRate);
 assert.equal(getSystemYield(s,w).production,v.after.colony.production);
 return{ordinaryCompletion:result};
});

run('Ordinary replacement retains old income through completion and applies new income on the next cycle',()=>{
 const {s,f,w}=fixture();w.charter={type:'extraction',level:1};const v=compare(s,w.id,building('market','mine'));
 const oldIncome=getEmpireStats(s).creditIncome;assert(command(s,v.project.command).ok);const paid=f.credits;let cycles=0;
 while(w.queue){assert(++cycles<10);assert(command(s,{type:'endTurn'}).ok);assert.equal(f.credits,paid+cycles*oldIncome);assert(validateSave(s));}
 const completed=f.credits,newIncome=getEmpireStats(s).creditIncome;assert.equal(newIncome,v.after.empire.creditIncome);
 assert(command(s,{type:'endTurn'}).ok);assert.equal(f.credits,completed+newIncome);assert(validateSave(s));
 return{cycles,oldIncome,newIncome};
});

run('Returned nested records are detached and JSON reload reproduces the same comparison',()=>{
 const {s,w}=fixture(),before=JSON.stringify(s),v=compare(s,w.id,forge);v.before.colony.population=999;v.project.cost.credits=999;v.throughput[0].before.cost.minerals=999;
 assert.equal(JSON.stringify(s),before);assert.deepEqual(compare(clone(s),w.id,forge),compare(s,w.id,forge));
});

const sources=Object.fromEntries(['src/investment.js','src/game.js','src/development.js','src/content.js','src/fleet-management.js'].map(p=>[p,hash(fs.readFileSync(path.join(repo,p)))]));
const result={generatedAt:new Date().toISOString(),method:'Independent bounded synthetic fixture checks and two ordinary-command completion oracles at fixed population/technology. No historical or ongoing campaign state accessed; no campaign cohort. Source rules are unchanged.',sources,scriptSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url))),checks};
fs.writeFileSync(path.join(out,'projection-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:checks.length,ordinaryChecks:checks.filter(c=>c.ordinaryCompletion||c.oldIncome)},null,2));
