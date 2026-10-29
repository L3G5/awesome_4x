/** Optional engine reproductions. Never alters the archived reports or game checkout. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const root=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(root,'../..');
const mode=process.argv[2];
if(!['strategy','replayability','benchmark','ecology'].includes(mode)){
 console.log('Usage: node reproduce.mjs strategy|replayability|benchmark|ecology [empty-output-directory]\nUses Git source pins, Node22+, and existing repository campaign transcripts. Browser scripts remain environment-specific original evidence.');
 process.exit(mode?1:0);
}
execFileSync(process.execPath,[path.join(root,'verify.mjs')],{stdio:'inherit'});
const output=process.argv[3]?path.resolve(process.argv[3]):fs.mkdtempSync(path.join(os.tmpdir(),'asterion-stage29-'+mode+'-'));
assert.ok(!fs.existsSync(output)||!fs.readdirSync(output).length,'output directory must be empty');
fs.mkdirSync(output,{recursive:true});
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'asterion-stage29-engine-'));
const inv=JSON.parse(fs.readFileSync(path.join(root,'source-inventory.json')));
const baselinePin='93a62961e994994d30c05240b17c39a418020473';
const read=(group,file)=>{
 const entry=inv.files.find(item=>item.group===group&&item.file===file);assert.ok(entry,group+'/'+file);
 const stored=fs.readFileSync(path.join(root,entry.storedPath));return (entry.compression==='gzip'?gunzipSync(stored):stored).toString();
};
const exported=new Map();
function engine(pin,name){
 if(exported.has(name))return exported.get(name);
 const dir=path.join(scratch,name);fs.mkdirSync(dir,{recursive:true});
 const bytes=execFileSync('git',['archive',pin,'src','package.json','scripts/campaign-benchmark.mjs'],{cwd:repo,maxBuffer:8*1024*1024});
 execFileSync('tar',['-x','-C',dir],{input:bytes});exported.set(name,dir);return dir;
}
const escaped=value=>value.replaceAll('\\','\\\\').replaceAll("'","\\'");
function run(name,source){
 const file=path.join(scratch,name+'.mjs');fs.writeFileSync(file,source);
 const stdout=execFileSync(process.execPath,[file],{cwd:repo,encoding:'utf8',maxBuffer:16*1024*1024});
 fs.writeFileSync(path.join(output,name+'-stdout.txt'),stdout);
}
try{
 if(mode==='ecology'){
  engine(baselinePin,'asterion-ecology-baseline');
  const changed=engine(baselinePin,'asterion-ecology-priority');
  execFileSync('git',['apply','--check'],{cwd:changed,input:read('ecology','ecology-priority.patch')});
  execFileSync('git',['apply'],{cwd:changed,input:read('ecology','ecology-priority.patch')});
  const expected=JSON.parse(read('ecology','paired-cohort.json')).sourceHashes.candidate;
  for(const [file,digest]of Object.entries(expected))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(changed,'src',file))).digest('hex'),digest,'reconstructed Ecology source '+file);
  const intermediate=path.join(scratch,'asterion-ecology-evidence');fs.mkdirSync(intermediate);
  let source=read('ecology','paired-cohort.mjs').replaceAll('/tmp/asterion-ecology-',escaped(scratch)+'/asterion-ecology-');
  run('ecology-paired',source);
  for(const file of fs.readdirSync(intermediate))fs.copyFileSync(path.join(intermediate,file),path.join(output,file));
 }else if(mode==='strategy'){
  const baseline=engine(baselinePin,'baseline'),changed=engine('46ffa85ba0438cf2d4ec0134431dfa32bb80a947','strategy-changed');
  const probeOut=path.join(output,'probe'),comparisonOut=path.join(output,'comparison');fs.mkdirSync(probeOut);fs.mkdirSync(comparisonOut);
  let probe=read('strategy','probe.mjs').replaceAll('/home/leg/projects/awesome_4x/src/',escaped(baseline)+'/src/').replaceAll('/home/leg/projects/awesome_4x',escaped(repo)).replaceAll('/tmp/asterion-critique-strategy',escaped(probeOut));
  run('strategy-probe',probe);
  let comparison=read('strategy','compare-implementation.mjs').replaceAll('/tmp/asterion-strategy-implementation',escaped(changed)).replaceAll('/home/leg/projects/awesome_4x',escaped(repo)).replaceAll('/tmp/asterion-critique-strategy/implementation',escaped(comparisonOut));
  run('strategy-comparison',comparison);
 }else if(mode==='replayability'){
  const baseline=engine(baselinePin,'baseline');
  const source=read('replayability','audit.mjs').replaceAll('/home/leg/projects/awesome_4x',escaped(baseline)).replaceAll('/tmp/asterion-critique-replayability',escaped(output));
  run('replayability-audit',source);
 }else{
  const baseline=engine(baselinePin,'baseline');
  const stdout=execFileSync(process.execPath,[path.join(baseline,'scripts/campaign-benchmark.mjs'),path.join(output,'policy-benchmark.json')],{cwd:baseline,encoding:'utf8',maxBuffer:16*1024*1024});
  fs.writeFileSync(path.join(output,'benchmark-stdout.txt'),stdout);
 }
 console.log(JSON.stringify({mode,output,archivedEvidenceUnchanged:true},null,2));
}finally{fs.rmSync(scratch,{recursive:true,force:true});}
