import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const repo=process.env.REVIEW_REPO||'/tmp/asterion-stage20-expedition';
const out=process.env.REVIEW_OUT||path.dirname(new URL(import.meta.url).pathname);mkdirSync(out,{recursive:true});
const pin='fe09832333e98886568beb6e3a07c84bccbb285b';
const sha=value=>createHash('sha256').update(value).digest('hex');
const source=readFileSync(path.join(repo,'src/ai.js'),'utf8');
assert.equal(source,execFileSync('git',['show',`${pin}:src/ai.js`],{cwd:repo,encoding:'utf8'}));
const game=await import(pathToFileURL(path.join(repo,'src/game.js')));
const {createGame,command,validateSave}=game;
const {runAI}=await import(pathToFileURL(path.join(repo,'src/ai.js')));
const {TECHS,SHIPS}=await import(pathToFileURL(path.join(repo,'src/content.js')));
const {getPublicRaces}=await import(pathToFileURL(path.join(repo,'src/victory.js')));
const url=pathToFileURL(path.join(repo,'src/ai.js'));
const querySource=source.replace(/from '(\.\/[^']+)'/g,(_,s)=>`from '${new URL(s,url).href}'`)+ '\nexport {reinforceIntervention,advanceIntervention,interventionCandidate,threatsToColonies,route};\n';
writeFileSync(path.join(out,'query-module.mjs'),querySource);
const q=await import(pathToFileURL(path.join(out,'query-module.mjs')));
const baselinePin=execFileSync('git',['rev-parse',`${pin}^`],{cwd:repo,encoding:'utf8'}).trim();
const baselineSource=execFileSync('git',['show',`${baselinePin}:src/ai.js`],{cwd:repo,encoding:'utf8'});
writeFileSync(path.join(out,'baseline-query-module.mjs'),baselineSource.replace(/from '(\.\/[^']+)'/g,(_,s)=>`from '${new URL(s,url).href}'`)+ '\nexport {advanceIntervention,interventionCandidate};\n');
const baseline=await import(pathToFileURL(path.join(out,'baseline-query-module.mjs')));
const clone=x=>JSON.parse(JSON.stringify(x));
const actor=s=>s.factions.find(f=>f.id==='veyr');
const leader=s=>s.factions.find(f=>f.id==='player');
const world=(s,id)=>s.systems.find(w=>w.id===id);
const fleet=(s,id)=>s.fleets.find(f=>f.id===id);
function add(s,owner,systemId,ships=1,hp=ships*34,type='frigate',movesLeft=2){const f={id:`f${s.nextFleetId++}`,owner,systemId,ships,hp,type,movesLeft,name:'Independent synthetic reinforcement'};s.fleets.push(f);return f;}
function fixture(orders=6){
 const s=createGame('INDEPENDENT-EXPEDITION-CORE');s.turn=50;s.fleets=[];
 for(const f of s.factions){Object.assign(f,{orders:0,credits:0,minerals:0,science:0,techs:Object.keys(TECHS),research:null,contacts:[]});for(const r of Object.values(f.relations))Object.assign(r,{status:'peace',trade:false,trust:0,treatyTurn:1});}
 for(const w of s.systems){w.anomaly=null;w.queue=null;}
 actor(s).orders=orders;actor(s).contacts=['player'];leader(s).contacts=['veyr'];actor(s).relations.player.status=leader(s).relations.veyr.status='war';
 for(const id of ['s0','s7','s8'])Object.assign(world(s,id),{owner:'player',population:8,buildings:['beacon'],knownBy:['player','veyr'],exploredBy:['player']});
 leader(s).credits=1000;leader(s).alignment={progress:7,active:true,started:true,sites:['s0','s7','s8'],reportedBeacons:['s0','s7','s8']};
 const route=['s1','s4','s5','s6','s0'];s.lanes=route.slice(1).map((id,i)=>[route[i],id]);
 for(const id of route)if(!world(s,id).knownBy.includes('veyr'))world(s,id).knownBy.push('veyr');
 const selected=add(s,'veyr','s1',2),mate=add(s,'veyr','s1');
 actor(s).strategy={mode:'advance',rallyId:'s1',objectiveId:'s0',turn:s.turn,expedition:{fleetId:selected.id,targetId:'player',systemId:'s0'}};
 assert.ok(validateSave(s));return{s,selected,mate,route};
}
function candidate(s,f){return q.interventionCandidate(s,actor(s),getPublicRaces(s,'veyr').find(r=>r.factionId==='player'),world(s,'s0'),f);}
function advance(s,f){const actions=[],initial=candidate(s,f);assert.ok(initial);const result=q.advanceIntervention(s,actor(s),initial,a=>{actions.push(clone(a));const r=command(s,{...a,factionId:'veyr'});assert.ok(r.ok);assert.ok(validateSave(s));return r;});return{actions,result};}
const result={requestedCommit:pin,checkoutHead:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),started:new Date().toISOString(),baselinePin,scope:'Six independently authored synthetic core probes. No campaign sample or benchmark methodology review.',aiSha256:sha(source),testSha256:sha(readFileSync(path.join(repo,'tests/ai-expedition-reinforcement.test.js'))),cases:[]};
function test(name,fn){try{const evidence=fn();result.cases.push({name,status:'pass',...evidence});}catch(e){result.cases.push({name,status:'fail',message:e.message,stack:e.stack});}console.log(JSON.stringify(result.cases.at(-1)));}
test('reject the stronger delayed partner, then accept a weaker partner without paying for rejection',()=>{
 const {s,selected,mate}=fixture(3);s.lanes=[['s1','s4'],['s4','s0'],['s1','s5'],['s5','s6'],['s6','s0']];
 Object.assign(world(s,'s4'),{owner:'player',population:8,buildings:[],knownBy:['player','veyr'],exploredBy:['player']});
 for(const id of ['s5','s6'])Object.assign(world(s,id),{owner:null,population:0,buildings:[],knownBy:['veyr'],exploredBy:['veyr']});
 leader(s).techs=['singularity'];mate.ships=2;mate.hp=68;const weak=add(s,'veyr','s1',1,10);add(s,'veyr','s6',1,18,'scout');add(s,'player','s6',2,48);
 const before=candidate(s,selected),strong=clone(s),weakCopy=clone(s);assert.deepEqual(before.travel.path,['s1','s4','s0']);assert.equal(before.arrivalCycles,1);
 assert.ok(command(strong,{type:'merge',factionId:'veyr',fleetId:selected.id,targetFleetId:mate.id}).ok);assert.equal(candidate(strong,fleet(strong,selected.id)).arrivalCycles,2);
 assert.ok(command(weakCopy,{type:'merge',factionId:'veyr',fleetId:selected.id,targetFleetId:weak.id}).ok);assert.equal(candidate(weakCopy,fleet(weakCopy,selected.id)).arrivalCycles,1);
 const actual=advance(s,selected);assert.equal(actual.actions[0].type,'merge');assert.equal(actual.actions[0].targetFleetId,weak.id);assert.equal(actual.actions.filter(a=>a.type==='merge').length,1);assert.ok(fleet(s,mate.id));assert.equal(selected.systemId,'s0');assert.equal(actor(s).orders,0);
 for(const action of actual.actions.slice(1))assert.ok(command(weakCopy,{...action,factionId:'veyr'}).ok);assert.deepEqual(s,weakCopy);
 return{actions:actual.actions,strongArrivalCycles:2,chosenArrivalCycles:1,finalShips:selected.ships,finalHull:selected.hp,orders:actor(s).orders};
});
test('one absorption at each of two departure boundaries does not sweep another local partner',()=>{
 const{s,selected,mate,route}=fixture(6),intermediate=add(s,'veyr',route[1]),spare=add(s,'veyr',route[1]);
 const mission=clone(actor(s).strategy.expedition),before=clone(s),actual=advance(s,selected);
 assert.deepEqual(actual.actions.map(a=>a.type),['merge','move','merge','move']);assert.equal(actual.actions[0].targetFleetId,mate.id);assert.equal(actual.actions[2].targetFleetId,intermediate.id);assert.ok(fleet(s,spare.id));assert.equal(selected.ships,4);assert.equal(selected.movesLeft,0);assert.equal(actor(s).orders,2);assert.deepEqual(actor(s).strategy.expedition,mission);
 for(const action of actual.actions)assert.ok(command(before,{...action,factionId:'veyr'}).ok);assert.deepEqual(s,before);
 return{actions:actual.actions,unchangedMission:mission,spareId:spare.id,orders:actor(s).orders};
});
test('an exact-cap merge uses ordinary fractional hull and route, Hold, lead and heritage semantics',()=>{
 const{s,selected,mate,route}=fixture(5);selected.ships=11;selected.hp=374;selected.hold=true;selected.route={destinationId:'s0',path:[...route]};mate.hp=.06;mate.hold=true;mate.defenseLead=true;mate.route={destinationId:route[1],path:route.slice(0,2)};mate.heritage=[{id:'review-origin',name:'Last Light',systemId:'s4',discoveryId:'forge',choiceId:'ship',turn:10,factionId:'veyr',fleetId:mate.id}];
 assert.ok(validateSave(s));const expected=clone(s),actions=[];
 const answer=q.reinforceIntervention(s,actor(s),candidate(s,selected),action=>{actions.push(clone(action));const r=command(s,{...action,factionId:'veyr'});assert.ok(validateSave(s));return r;});assert.equal(answer,true);assert.equal(actions.length,1);
 assert.ok(command(expected,{...actions[0],factionId:'veyr'}).ok);assert.deepEqual(s,expected);assert.equal(selected.ships,12);assert.equal(selected.hp,374.06);assert.equal(selected.movesLeft,2);assert.equal(selected.hold,true);assert.equal(selected.defenseLead,true);assert.equal(selected.heritage[0].name,'Last Light');assert.deepEqual(selected.route,{destinationId:'s0',path:route});
 assert.ok(command(s,{type:'move',factionId:'veyr',fleetId:selected.id,targetId:route[1]}).ok);assert.equal(selected.hold,undefined);assert.equal(selected.defenseLead,undefined);assert.deepEqual(selected.route.path,route.slice(1));assert.ok(validateSave(s));
 return{merge:actions[0],ships:selected.ships,hull:selected.hp,movesAfterOneJump:selected.movesLeft,heritage:selected.heritage[0].name};
});
test('private foreign fleet and weapons/research getters are unread during the reinforcement decision',()=>{
 const{s,selected}=fixture(3);const enemy=add(s,'player','s0',12,1020,'cruiser');const initial=candidate(s,selected);const frozenOwn=clone(actor(s));
 const forbid=(obj,keys)=>{for(const key of keys)Object.defineProperty(obj,key,{get(){throw new Error(`Unobserved private read: ${key}`);},enumerable:true,configurable:true});};
 forbid(enemy,['type','ships','hp']);for(const f of s.factions.filter(f=>f.id!=='veyr'))forbid(f,['credits','minerals','science','techs','research']);
 function freezeData(obj){if(obj&&typeof obj==='object'){for(const descriptor of Object.values(Object.getOwnPropertyDescriptors(obj)))if('value'in descriptor)freezeData(descriptor.value);Object.freeze(obj);}return obj;}freezeData(s);
 const actions=[];assert.equal(q.reinforceIntervention(s,actor(s),initial,a=>{actions.push(clone(a));return{ok:true};}),true);assert.equal(actions.length,1);assert.deepEqual(actor(s),frozenOwn);
 return{actions,readBoundary:'Spatial identity/position may be used by existing visibility queries; unobserved hull/class/count and foreign weapons/research/economy getters throw if read.',purePreflightOnFrozenSave:true};
});
test('the paid war declaration leaves the correct full-run order allowance for optional absorption',()=>{
 const cases=[];for(const orders of [3,4]){const{s,selected,mate,route}=fixture(orders);actor(s).relations.player.status=leader(s).relations.veyr.status='peace';const id=selected.id,credits=actor(s).credits,rng=s.rng;runAI(s,actor(s));assert.equal(actor(s).relations.player.status,'war');assert.equal(selected.systemId,route[2]);assert.equal(selected.movesLeft,0);assert.equal(actor(s).orders,0);assert.equal(selected.ships,orders===4?3:2);assert.equal(Boolean(fleet(s,mate.id)),orders===3);assert.equal(actor(s).strategy.expedition.fleetId,id);assert.equal(actor(s).strategy.expedition.targetId,'player');assert.equal(actor(s).credits,credits);assert.equal(s.rng,rng);assert.ok(validateSave(s));cases.push({initialOrders:orders,ships:selected.ships,mateSurvives:Boolean(fleet(s,mate.id)),finalOrders:actor(s).orders,systemId:selected.systemId});}return{cases};
});
test('nonhostile first contact keeps the exact pre-change movement behavior',()=>{
 const{s,selected,mate}=fixture(3);mate.systemId='s2';add(s,'choir','s4',1,18,'scout');
 const previous=clone(s),oldFleet=fleet(previous,selected.id),race=getPublicRaces(previous,'veyr').find(r=>r.factionId==='player');
 const oldCandidate=baseline.interventionCandidate(previous,actor(previous),race,world(previous,'s0'),oldFleet),oldActions=[];
 const oldResult=baseline.advanceIntervention(previous,actor(previous),oldCandidate,a=>{oldActions.push(clone(a));return command(previous,{...a,factionId:'veyr'});});
 const current=advance(s,selected);assert.deepEqual(current.actions,oldActions);assert.deepEqual(current.result,oldResult);assert.deepEqual(s,previous);assert.ok(actor(s).contacts.includes('choir'));assert.equal(current.actions.length,2);assert.ok(validateSave(s));
 return{actions:current.actions,firstContact:'choir',sameCompleteStateAsFixedEngineBaseline:true,interpretation:'Nonhostile contact by itself did not stop this expedition before the patch and still does not; the existing actual-combat stop is unchanged.'};
});
result.finished=new Date().toISOString();result.passed=result.cases.filter(c=>c.status==='pass').length;result.failed=result.cases.filter(c=>c.status==='fail').length;writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2)+'\n');process.exitCode=result.failed?1:0;
