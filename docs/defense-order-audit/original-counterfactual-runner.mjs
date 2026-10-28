import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createGame,command,endTurn,validateSave} from '/tmp/asterion-iron-covenant/replay/engine/src/game.js';
const receipts=JSON.parse(fs.readFileSync('/tmp/asterion-iron-covenant/replay/commands.json'));
const baseline=createGame('IRON-COVENANT-10');
for(const {action}of receipts){if(action.type==='endTurn'&&baseline.turn===41)break;const r=action.type==='endTurn'?endTurn(baseline):command(baseline,action);assert.ok(r.ok);}
const before=baseline.fleets.filter(f=>f.owner==='player'&&f.systemId==='s13').map(f=>structuredClone(f));
const screen=JSON.parse(JSON.stringify(baseline)), own=screen.fleets.map((f,i)=>({f,i})).filter(x=>x.f.owner==='player'&&x.f.systemId==='s13');
assert.equal(own.length,2);assert.equal(own[0].f.type,'frigate');assert.equal(own[1].f.type,'cruiser');
[screen.fleets[own[0].i],screen.fleets[own[1].i]]=[screen.fleets[own[1].i],screen.fleets[own[0].i]];
endTurn(baseline);endTurn(screen);assert.ok(validateSave(baseline)&&validateSave(screen));
const project=s=>({reports:s.combatReports.filter(r=>r.turn===41&&r.systemId==='s13'),ownSable:s.fleets.filter(f=>f.owner==='player'&&f.systemId==='s13').map(f=>({id:f.id,type:f.type,ships:f.ships,hp:f.hp})),rng:s.rng});
const result={method:'Explicit hypothetical defensive-screen experiment on the verified historical cycle41 position. Replay all ordinary UI receipts up to before the41 rival phase, then exchange only the two own co-located Sable fleet positions in the fleet array. No game source edits and no campaign action changes. This is not an actual UI action or balanced implementation; it isolates pairwise defender order.',before,baseline:project(baseline),cruiserFirst:project(screen)};
fs.writeFileSync('/tmp/asterion-screen-counterfactual.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
