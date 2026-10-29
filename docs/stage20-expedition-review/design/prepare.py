from pathlib import Path
import shutil,hashlib,json,subprocess
base=Path('/tmp/asterion-watch-ai-audit');source=Path('/home/leg/projects/awesome_4x/docs/watch-playtest/replay/engine')
shutil.copytree(source,base/'engine',dirs_exist_ok=True)
p=base/'engine/src/ai.js';s=p.read_text();original=s
s=s.replace('export function runAI(state, faction) {','export function runAI(state, faction) {\n  globalThis.__watchAudit?.(\'entry\', state, faction);')
s=s.replace('const act = action => command(state, { ...action, factionId: id });',"const act = action => { globalThis.__watchAudit?.('before', state, faction, action); const result = command(state, { ...action, factionId: id }); globalThis.__watchAudit?.('after', state, faction, action, result); return result; };")
s+='\n// Audit-only pure queries; no production policy changes.\nexport const auditQueries = { route, strength, canAssault, threatsToColonies, selectObjective, selectRally, raceIntervention, interventionCandidate };\n'
p.write_text(s)
(base/'instrumentation.json').write_text(json.dumps({'enginePin':'a9c61ff','originalAiSha256':hashlib.sha256(original.encode()).hexdigest(),'currentAiSha256':hashlib.sha256(subprocess.check_output(['git','show','HEAD:src/ai.js'],cwd='/home/leg/projects/awesome_4x')).hexdigest(),'instrumentedAiSha256':hashlib.sha256(s.encode()).hexdigest(),'changes':'Passive entry/before/after command callbacks and exported pure query references only.'},indent=2)+'\n')
