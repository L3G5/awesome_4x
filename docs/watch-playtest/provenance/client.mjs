import fs from 'node:fs';
const input=JSON.parse(process.argv[2]);const response=await fetch('http://127.0.0.1:5188',{method:'POST',body:JSON.stringify(input)});const result=await response.json();fs.appendFileSync('/tmp/asterion-watch14/observations.ndjson',JSON.stringify({time:new Date().toISOString(),input,result})+'\n');
if(result.error){console.error('AUTOMATION ERROR: '+result.error);process.exitCode=1;}
if(!result.view){console.log(JSON.stringify(result));process.exit();}
const v=result.view;let previous={};try{previous=JSON.parse(fs.readFileSync('/tmp/asterion-watch14/known.json'));}catch{}
const known=Object.fromEntries(v.systems.map(w=>[w.id,w]));const changed=v.systems.filter(w=>!previous[w.id]||w.surveyed!==previous[w.id].surveyed||w.owner!==previous[w.id].owner);
fs.writeFileSync('/tmp/asterion-watch14/known.json',JSON.stringify(known,null,2));
fs.writeFileSync('/tmp/asterion-watch14/visible-latest.json',JSON.stringify(v,null,2));
console.log(JSON.stringify({dom:result.dom,view:{turn:v.turn,winner:v.winner,faction:v.ownFaction,owned:v.systems.filter(w=>w.owner==='player'),newOrChangedWorlds:changed,fleets:v.fleets,lanes:v.lanes,publicRaces:v.publicRaces}}));
