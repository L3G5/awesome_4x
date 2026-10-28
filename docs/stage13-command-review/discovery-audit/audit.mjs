import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const repo=process.argv[2]||'/tmp/asterion-stage12-diplomacy';
const {createGame,command,endTurn,getSystemYield,getInfrastructure,validateSave}=await import(pathToFileURL(path.join(repo,'src/game.js')));
const {getDiscoveryOptions}=await import(pathToFileURL(path.join(repo,'src/discoveries.js')));
const {runAI}=await import(pathToFileURL(path.join(repo,'src/ai.js')));
const {TECHS}=await import(pathToFileURL(path.join(repo,'src/content.js')));
const faction=s=>s.factions.find(f=>f.id==='player');
function fixture(id){const s=createGame('discovery-preview-audit'),world=s.systems.find(w=>w.id==='s0');world.anomaly={id,resolved:false};return {s,world,f:faction(s)};}
const cases=[];
{
 const {s,world,f}=fixture('pilgrims');world.population=8;world.growth=.7;
 const before={population:world.population,yield:getSystemYield(s,world),infrastructure:getInfrastructure(s,world),credits:f.credits,orders:f.orders};
 const choice=getDiscoveryOptions(s,world.id).find(c=>c.id==='welcome');
 assert.equal(validateSave(s),true);const result=command(s,{type:'anomaly',systemId:world.id,choiceId:'welcome'});assert.equal(result.ok,true);assert.equal(world.population,9);
 const after={population:world.population,yield:getSystemYield(s,world),infrastructure:getInfrastructure(s,world),credits:f.credits,orders:f.orders};
 assert.equal(before.credits-after.credits,20);assert.equal(before.orders-after.orders,1);assert.equal(validateSave(s),true);
 const reload=JSON.parse(JSON.stringify(s));endTurn(s);endTurn(reload);assert.deepEqual(s,reload);assert.equal(validateSave(s),true);assert.equal(world.population,9);assert.equal(world.growth,0);
 cases.push({name:'Full capital accepts refugees above natural-growth capacity',fixture:'Synthetic boundary setup; ordinary anomaly and endTurn commands.',choice:{description:choice.description,enabled:choice.enabled},before,after,nextTurn:{population:world.population,capacity:getSystemYield(s,world).capacity,growth:world.growth},history:world.anomaly.history[0].effects,reloadExact:true});
}
for(const habitability of [95,100]){
 const {s,world}=fixture('garden');world.habitability=habitability;
 const choice=getDiscoveryOptions(s,world.id).find(c=>c.id==='preserve');
 assert.equal(command(s,{type:'anomaly',systemId:world.id,choiceId:'preserve'}).ok,true);
 assert.equal(world.habitability,100);assert.equal(validateSave(s),true);
 cases.push({name:`Garden at ${habitability}%`,choice:{description:choice.description,enabled:choice.enabled,nominalHabitability:choice.habitability},actual:world.anomaly.history[0].effects});
}
{
 const {s,world}=fixture('echo');for(const w of s.systems)if(!w.knownBy.includes('player'))w.knownBy.push('player');
 const choice=getDiscoveryOptions(s,world.id).find(c=>c.id==='reach');assert.equal(command(s,{type:'anomaly',systemId:world.id,choiceId:'reach'}).ok,true);assert.equal(world.anomaly.history[0].effects.charted,0);assert.equal(validateSave(s),true);
 cases.push({name:'Echo when all systems are already charted',choice:{description:choice.description,enabled:choice.enabled},actual:world.anomaly.history[0].effects});
}
{
 const {s,world,f}=fixture('forge');world.buildings=[];f.techs=[];const before=s.fleets.length;const choice=getDiscoveryOptions(s,world.id).find(c=>c.id==='ship');assert.equal(command(s,{type:'anomaly',systemId:world.id,choiceId:'ship'}).ok,true);assert.equal(s.fleets.length,before+1);assert.equal(validateSave(s),true);
 const fleet=s.fleets.at(-1);cases.push({name:'Escort needs neither a shipyard nor technology',choice:{description:choice.description,enabled:choice.enabled},fleet:{type:fleet.type,ships:fleet.ships,hp:fleet.hp,movesLeft:fleet.movesLeft}});
}
{
 const {s,world,f}=fixture('pilgrims');f.techs=Object.keys(TECHS);f.credits=1000;f.minerals=1000;world.owner=null;world.population=0;world.buildings=[];world.growth=0;
 s.fleets=s.fleets.filter(x=>x.owner!=='player'||x.type!=='frigate');for(const fleet of s.fleets.filter(x=>x.owner==='player')){fleet.movesLeft=0;if(fleet.type==='colony')fleet.systemId='s1';}
 const choice=getDiscoveryOptions(s,world.id).find(c=>c.id==='welcome');const before=f.credits;assert.equal(validateSave(s),true);runAI(s,f);const history=world.anomaly.history;
 assert.equal(history?.[0]?.choiceId,'welcome');assert.equal(history[0].effects.population.amount,0);assert.equal(validateSave(s),true);
 cases.push({name:'Ark-surviving empire without an owned capital: AI pays for zero population',fixture:'Synthetic valid no-colony/remaining-Ark setup; all technologies complete, 1000 credits and minerals (reserves satisfied), own fleets have no moves, Ark in foreign territory; ordinary runAI command path.',choice:{description:choice.description,enabled:choice.enabled},creditsBefore:before,creditsAfter:f.credits,actual:history[0].effects});
}
const hashes=Object.fromEntries(['src/game.js','src/discoveries.js','src/discovery-ui.js','src/ai.js','src/content.js','src/development.js','tests/discoveries.test.js'].map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(repo,f))).digest('hex')]));
const result={generatedAt:new Date().toISOString(),method:'Read-only source audit plus explicitly synthetic boundary fixtures. Every tested effect used ordinary command/endTurn/runAI entry points. No current campaign checkpoint or hidden state was inspected. Actual human evidence is recorded DOM, screenshot and safe observer projection only.',sourceDirectory:repo,sources:hashes,cases};
fs.writeFileSync(new URL('results.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({cases:cases.map(c=>c.name),passed:true},null,2));
