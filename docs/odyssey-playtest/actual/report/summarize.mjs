import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(directory, name));
const json = name => JSON.parse(read(name));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const manifest = json('original-evidence-manifest.json');
for (const item of manifest.files) {
  if (sha(read(item.file)) !== item.sha256) throw new Error(`Original evidence differs: ${item.file}`);
}
const record = json('record.json');
const final = json('checkpoints/cycle66.json');
const own = final.factions.find(faction => faction.id === 'player');
const worlds = final.systems.filter(system => system.owner === 'player');
const fleets = final.fleets.filter(fleet => fleet.owner === 'player');
const events = record.events;
const actions = {};
for (const event of events) {
  if (event.kind !== 'interaction') continue;
  const action = event.action?.actualControl?.attributes?.['data-action'];
  if (action) actions[action] = (actions[action] || 0) + 1;
}
const start = events.find(event => event.action?.actualControl?.attributes?.['data-action'] === 'new-game-confirm');
const ending = events.find(event => event.kind === 'command' && /Cycle 66/.test(event.cycle));
const exported = events.filter(event => event.kind === 'export').map(event => {
  const file = `checkpoints/${path.basename(event.path)}`;
  const saved = json(file);
  return { file, turn: saved.turn, time: event.time, sha256: sha(read(file)), provenance: 'Actual UI download' };
});
const finalExports = exported.filter(item => item.turn === 66);
if (!finalExports.every(item => item.sha256 === finalExports[0].sha256)) throw new Error('Final inspection exports differ');
const summary = {
  generatedAt: new Date().toISOString(),
  method: 'Read-only summarization of frozen original UI receipts and actual exports. This script does not run game commands, replay a policy, inspect foreign private assets, or attribute raids to AI implementation details.',
  seed: final.seed,
  version: '0.20.0',
  sourceCommit: '47e037308271ff3d3ac0d1fc870a889cdf0a67c4',
  build: json('frozen-build.json'),
  outcome: { winner: final.winner, victoryType: final.victoryType, turn: final.turn, legacy: 604, legacySource: 'Actual ending DOM retained in observations.ndjson' },
  play: { startedAt: start.time, endedAt: ending.time, minutes: Math.round((Date.parse(ending.time) - Date.parse(start.time)) / 6000) / 10 },
  ownFinalHoldings: { colonies: worlds.length, population: worlds.reduce((n, system) => n + system.population, 0), ships: fleets.reduce((n, fleet) => n + fleet.ships, 0), frigates: fleets.filter(fleet => fleet.type === 'frigate').reduce((n, fleet) => n + fleet.ships, 0), scouts: fleets.filter(fleet => fleet.type === 'scout').reduce((n, fleet) => n + fleet.ships, 0), technologies: own.techs.length, credits: own.credits, minerals: own.minerals, science: own.science, alignment: own.alignment.progress },
  actualReceiptCounts: { interactions: events.filter(event => event.kind === 'interaction').length, completedCycles: events.filter(event => event.kind === 'command').length, decisions: events.filter(event => event.kind === 'decision').length, exports: exported.length, screenshots: events.filter(event => event.kind === 'image').length, quickCommissions: actions.reinforce, directMerges: actions.merge, chooserConfirmations: actions['merge-confirm'], paidRepairs: actions.repair },
  countLimits: 'Interaction counts include inspection and navigation. Commission/merge/repair counts count successful UI receipts; independent command reconstruction is separate. No event count is a statistical sample or win-rate estimate.',
  driverErrors: events.filter(event => event.kind === 'driver-error').map(event => ({ cycle: event.cycle, time: event.time, message: event.message.split('\n')[0] })),
  browserErrorLines: read('browser-errors.ndjson').toString().trim().split('\n').filter(Boolean).length,
  reloadsDuringPlay: 0,
  rollbacks: 0,
  endedInspection: { identicalFinalExports: finalExports.length, sha256: finalExports[0].sha256, checked: ['Menu reopening', 'Chronicle reopening', 'Retained combat report and expanded rounds', 'Stillwater expedition history', 'World link closes ending and opens Nacre'] },
  retainedReports: final.combatReports.map(report => ({ id: report.id, turn: report.turn, systemId: report.systemId, summary: report.summary })),
  exports: exported,
  derivedCheckpoints: [],
  replayStatus: 'Independent reconstruction is being prepared separately; no derived checkpoint is represented here as an actual UI download.',
  limitations: ['One manually directed campaign on one seed; no difficulty or win-rate generalization.', 'No untouched cycle55 or pre-relief cycle56/57 export exists. Any reconstruction requires matching later actual exports.', 'Round numbers use the recorded operations cycle; an AI turn battle appears in the following arrival briefing.', 'No causal attribution to the Stage20 absorption helper.', 'Seven driver failures are preserved, including a cycle52/53 sequencing error and two postgame hidden-selector errors.', 'The screenshot named cycle66-reopened-retained-battle-rounds.png actually shows a menu after a driver error; use cycle66-retained-battle-rounds-verified.png instead.']
};
fs.writeFileSync(path.join(directory, 'report/summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ outcome: summary.outcome, play: summary.play, counts: summary.actualReceiptCounts, errors: summary.driverErrors.length, finalSha256: finalExports[0].sha256 }, null, 2));
