/**
 * Reproducible simulation benchmark. Runs from any working directory.
 * Full campaign snapshots go to /tmp unless an explicit output path is given.
 * This is a policy experiment, not a test of human skill or game win rates.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame, command, endTurn, getEmpireStats, getBuildOptions, getResearchOptions, getDevelopmentOptions, validateSave } from '../src/game.js';
import { runAI } from '../src/ai.js';
import { getDiplomacyForecast } from '../src/diplomacy.js';
import { getVisibleFleets } from '../src/intelligence.js';
import { SHIPS } from '../src/content.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const outputPath = resolve(process.argv[2] || '/tmp/asterion-campaign-benchmark.json');
if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/campaign-benchmark.mjs [output.json]\nRuns 20 fixed seeds for each of four player policies. Default output: /tmp/asterion-campaign-benchmark.json');
  process.exit(0);
}
const seeds=['ASTERION',...Array.from({length:19},(_,i)=>`stage4-audit-${i+1}`)];
const techPriority={
 science:['physics','logistics','computing','industry','singularity','ecology','diplomacy','shields','command','weapons','cruisers','terraforming'],
 military:['weapons','logistics','shields','cruisers','command','ecology','diplomacy','industry','physics','computing','singularity','terraforming'],
 balanced:['logistics','ecology','physics','industry','diplomacy','weapons','computing','shields','singularity','command','cruisers','terraforming']
};
function playerPolicy(state,mode){
 if(mode==='passive')return;
 const player=state.factions.find(f=>f.id==='player');
 if(!player.research){const options=getResearchOptions(state);const tech=techPriority[mode].find(id=>options.some(o=>o.id===id&&o.enabled));if(tech)command(state,{type:'research',techId:tech});}
 const owned=()=>state.systems.filter(s=>s.owner==='player');
 const reserve=()=>{
  const committed=owned().filter(s=>s.buildings.includes('beacon')||s.queue?.itemId==='beacon').length;
  const project=player.techs.includes('singularity')&&committed<3;
  return {credits:(project?180:0)+(player.alignment?.active?60:0),minerals:project?180:0};
 };
 const affordable=cost=>{const held=reserve();return player.credits-(cost.credits||0)>=held.credits&&player.minerals-(cost.minerals||0)>=held.minerals;};
 if(mode==='science'){
  for(const world of owned().filter(s=>!s.queue)){
   if(player.orders<=2)break;
   const lab=getBuildOptions(state,world.id).find(o=>o.id==='lab');
   if(lab?.enabled&&affordable(lab.cost)){command(state,{type:'build',systemId:world.id,itemId:'lab'});continue;}
   const academy=getDevelopmentOptions(state,world.id).find(o=>o.charterType==='academy');
   if(academy?.enabled&&!academy.switching&&affordable(academy.cost))command(state,{type:'develop',systemId:world.id,charterType:'academy'});
  }
 }
 if(mode==='military'){
  const stats=getEmpireStats(state);
  for(const world of owned().filter(s=>!s.queue&&s.buildings.includes('shipyard'))){
   if(player.orders<=2||stats.creditIncome<10)break;
   const hull=getBuildOptions(state,world.id).find(o=>o.id===(player.techs.includes('cruisers')?'cruiser':'frigate'));
   if(hull?.enabled&&affordable(hull.cost))command(state,{type:'build',systemId:world.id,itemId:hull.id});
  }
  if(stats.military>=75){
   for(const targetId of [...player.contacts].sort()){
    const forecast=getDiplomacyForecast(state,'player',targetId);
    const observed=getVisibleFleets(state,'player').filter(f=>f.owner===targetId).reduce((n,f)=>n+SHIPS[f.type].attack*f.ships,0);
    if(forecast.war.enabled&&stats.military>observed*1.4){command(state,{type:'diplomacy',targetId,stance:'war'});break;}
   }
  }
 }
 runAI(state,player);
}
function snapshot(state,id){
 const faction=state.factions.find(f=>f.id===id),stats=getEmpireStats(state,id),worlds=state.systems.filter(s=>s.owner===id);
 return {id,colonies:stats.colonies,population:stats.population,credits:stats.credits,minerals:stats.minerals,creditIncome:stats.creditIncome,mineralIncome:stats.mineralIncome,scienceIncome:stats.scienceIncome,military:stats.military,techs:faction.techs.length,protocol:faction.techs.includes('singularity'),beacons:stats.beacons,queuedBeacons:worlds.filter(s=>s.queue?.itemId==='beacon').length,alignment:faction.alignment?.progress||0,alignmentActive:!!faction.alignment?.active,charters:worlds.filter(s=>s.charter).map(s=>({systemId:s.id,type:s.charter.type,level:s.charter.level})),infrastructure:worlds.map(s=>({id:s.id,population:s.population,buildings:s.buildings,queue:s.queue?.itemId||null}))};
}
const policies = {
 passive: { subject: 'Three AI empires per game; 60 observations per empire milestone.', description: 'The player issues no commands. Measures autonomous rival development and race completion.' },
 science: { subject: 'Player empire; 20 observations per milestone.', description: 'Prioritizes the Protocol research path, commissions available laboratories and Academy Charters, then uses the shared AI for exploration, expansion, fleet control and remaining development.', researchPriority: techPriority.science },
 military: { subject: 'Player empire; 20 observations per milestone.', description: 'Prioritizes military research and affordable warships. At 75 military power, may declare war on a contacted empire if own power exceeds 1.4 times visible enemy power. Does not cap simultaneous wars. Uses shared AI for remaining actions.', researchPriority: techPriority.military },
 balanced: { subject: 'Player empire; 20 observations per milestone.', description: 'Uses a mixed research order and the shared AI for exploration, expansion, military control, economic specialization and beacon commitments.', researchPriority: techPriority.balanced },
};
const sourceFiles = ['src/ai.js', 'src/game.js', 'src/development.js', 'src/victory.js', 'src/content.js', 'src/intelligence.js', 'src/diplomacy.js', 'src/reports.js', 'scripts/campaign-benchmark.mjs'];
const sources = Object.fromEntries(sourceFiles.map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(resolve(root, name))).digest('hex')]));
const started=Date.now(),runs=[];
for(const mode of ['passive','science','military','balanced'])for(const seed of seeds){
 const state=createGame(seed),milestones=Object.fromEntries(state.factions.map(f=>[f.id,{firstTech:null,protocol:null,allTechs:null,firstCharter:null,firstBeacon:null,alignmentStart:null,alignmentPeak:0,interruptions:0}]));
 const snapshots=[];let invalid=null,negativeResource=null,firstWar=null,previousAlignment={};
 while(!state.winner&&state.turn<120){
  playerPolicy(state,mode);endTurn(state);
  if(!validateSave(state)&&invalid===null)invalid=state.turn;
  for(const faction of state.factions){
   const marker=milestones[faction.id],stats=getEmpireStats(state,faction.id),worlds=state.systems.filter(s=>s.owner===faction.id);
   if(faction.techs.length&&marker.firstTech===null)marker.firstTech=state.turn;
   if(faction.techs.includes('singularity')&&marker.protocol===null)marker.protocol=state.turn;
   if(faction.techs.length===12&&marker.allTechs===null)marker.allTechs=state.turn;
   if(worlds.some(s=>s.charter)&&marker.firstCharter===null)marker.firstCharter=state.turn;
   if(stats.beacons&&marker.firstBeacon===null)marker.firstBeacon=state.turn;
   if(faction.alignment?.active&&marker.alignmentStart===null)marker.alignmentStart=state.turn;
   marker.alignmentPeak=Math.max(marker.alignmentPeak,faction.alignment?.progress||0);
   if(previousAlignment[faction.id]?.active&&!faction.alignment?.active)marker.interruptions++;
   previousAlignment[faction.id]=structuredClone(faction.alignment);
   if([faction.credits,faction.minerals,faction.orders].some(n=>n<0)&&negativeResource===null)negativeResource=state.turn;
   if(firstWar===null&&Object.values(faction.relations).some(r=>r.status==='war'))firstWar=state.turn;
  }
  if([20,40,60,80,100,120].includes(state.turn))snapshots.push({turn:state.turn,factions:state.factions.map(f=>snapshot(state,f.id))});
 }
 runs.push({mode,seed,turn:state.turn,winner:state.winner,victoryType:state.victoryType,invalid,negativeResource,firstWar,milestones,snapshots,final:state.factions.map(f=>snapshot(state,f.id))});
 if(runs.length%20===0)console.log(JSON.stringify({completed:runs.length,mode,elapsedSeconds:Math.round((Date.now()-started)/1000)}));
}
const stats=values=>{const data=values.filter(v=>v!==null&&v!==undefined).sort((a,b)=>a-b);return {count:data.length,min:data[0]??null,median:data.length?(data[Math.floor((data.length-1)/2)]+data[Math.floor(data.length/2)])/2:null,max:data.at(-1)??null};};
const summary=Object.fromEntries(['passive','science','military','balanced'].map(mode=>{
 const group=runs.filter(run=>run.mode===mode),metrics=group.flatMap(run=>Object.entries(run.milestones).filter(([id])=>mode==='passive'?id!=='player':id==='player').map(([id,m])=>m));
 return [mode,{games:group.length,outcomes:group.reduce((map,run)=>(map[`${run.winner}:${run.victoryType}`]=(map[`${run.winner}:${run.victoryType}`]||0)+1,map),{}),finish:stats(group.map(run=>run.turn)),firstWar:stats(group.map(run=>run.firstWar)),firstTech:stats(metrics.map(m=>m.firstTech)),protocol:stats(metrics.map(m=>m.protocol)),allTechs:stats(metrics.map(m=>m.allTechs)),firstCharter:stats(metrics.map(m=>m.firstCharter)),firstBeacon:stats(metrics.map(m=>m.firstBeacon)),alignmentStart:stats(metrics.map(m=>m.alignmentStart)),totalInterruptions:metrics.reduce((n,m)=>n+m.interruptions,0),finalCharters:stats(group.flatMap(run=>run.final.filter(f=>mode==='passive'?f.id!=='player':f.id==='player').map(f=>f.charters.length))),invalid:group.filter(run=>run.invalid!==null).map(run=>({seed:run.seed,turn:run.invalid})),negativeResource:group.filter(run=>run.negativeResource!==null).map(run=>({seed:run.seed,turn:run.negativeResource}))}];
}));
const result = {
 generatedAt: new Date().toISOString(),
 elapsedSeconds: (Date.now() - started) / 1000,
 sources,
 seeds,
 policies,
 method: '20 fixed seeds per mode; no resource grants or hidden-fleet queries. All policies issue actions through the shared command API and retain ordinary faction traits. Every completed cycle checks save validity and nonnegative credits, minerals and orders. Timing medians include only empires reaching the milestone before the campaign ends; counts are reported alongside them. An even sample uses the mean of its middle pair. Passive timings describe 60 AI empires; other policy timings describe 20 player empires. Outcomes describe these automated policies, not human win rates. Alignment interruptions count transitions from active to inactive; this measure does not distinguish blockade, lost sites and funding shortfalls.',
 summary,
 runs,
};
fs.mkdirSync(dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ outputPath, elapsedSeconds: result.elapsedSeconds, summary }, null, 2));
if (runs.some(run => run.invalid !== null || run.negativeResource !== null || !run.winner)) process.exitCode = 1;
