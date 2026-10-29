/** Verify stored bytes, decompressed originals, original manifests and local report links. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root=path.dirname(fileURLToPath(import.meta.url));
const inventory=JSON.parse(fs.readFileSync(path.join(root,'source-inventory.json')));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'package-manifest.json')));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const contents=new Map();
const delegated=relative=>manifest.delegatedDirectories.some(dir=>relative===dir||relative.startsWith(dir+'/'));
for(const item of manifest.files){
 const bytes=fs.readFileSync(path.join(root,item.path));
 assert.equal(bytes.length,item.bytes,item.path+': stored size');
 assert.equal(sha(bytes),item.sha256,item.path+': stored hash');
}
for(const item of inventory.files){
 const stored=fs.readFileSync(path.join(root,item.storedPath));
 assert.equal(stored.length,item.storedBytes,item.storedPath+': original inventory storage size');
 assert.equal(sha(stored),item.storedSha256,item.storedPath+': original inventory storage hash');
 const bytes=item.compression==='gzip'?gunzipSync(stored):stored;
 assert.equal(bytes.length,item.originalBytes,item.storedPath+': original size');
 assert.equal(sha(bytes),item.originalSha256,item.storedPath+': original hash');
 contents.set(item.group+'/'+item.file,bytes);
}
let sourceManifestEntries=0;
for(const group of ['replayability','ecology']){
 const original=JSON.parse(contents.get(group+'/manifest.json'));
 for(const entry of original.files){
  const bytes=contents.get(group+'/'+entry.file);
  assert.ok(bytes,group+'/'+entry.file+': referenced by original manifest');
  assert.equal(sha(bytes),entry.sha256,group+'/'+entry.file+': original manifest hash');
  assert.equal(bytes.length,entry.bytes,group+'/'+entry.file+': original manifest size');
  sourceManifestEntries++;
 }
}
for(const line of contents.get('experience/manifest.sha256').toString().trim().split('\n')){
 const [digest,file]=line.split('  '),bytes=contents.get('experience/'+file);
 assert.ok(bytes,file+': referenced by original experience manifest');
 assert.equal(sha(bytes),digest,file+': original experience manifest hash');
 sourceManifestEntries++;
}
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):[path.join(dir,entry.name)]);
const ownedFiles=walk(root).filter(file=>!delegated(path.relative(root,file)));
const actual=ownedFiles.map(file=>path.relative(root,file)).filter(file=>file!=='package-manifest.json').sort();
assert.deepEqual(actual,manifest.files.map(item=>item.path).sort(),'package inventory is complete');
let localLinks=0;const deferredLocalLinks=[];
for(const file of ownedFiles.filter(file=>file.endsWith('.html'))){
 const text=fs.readFileSync(file,'utf8');
 for(const [,raw] of text.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/g)){
  if(/^(?:https?:|data:|mailto:|#)/.test(raw))continue;
  const [relative,fragment]=raw.split('#'),resolved=path.resolve(path.dirname(file),decodeURIComponent(relative.split('?')[0]));
  let target=resolved;
  if(!fs.existsSync(target)){
   // Vite/Pages serves public/ at the site root rather than under public/.
   const repo=path.resolve(root,'../..'),sitePath=path.relative(repo,resolved);
   const publicTarget=path.join(repo,'public',sitePath);
   if(fs.existsSync(publicTarget))target=publicTarget;
  }
  if(!fs.existsSync(target)&&manifest.deferredLocalLinks.includes(path.relative(root,resolved))){deferredLocalLinks.push(raw);continue;}
  assert.ok(fs.existsSync(target),path.relative(root,file)+': missing local link '+raw);
  if(fragment&&target.endsWith('.html')){
   const body=fs.readFileSync(target,'utf8');
   assert.ok(new RegExp(`\\bid=["']${fragment.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}["']`).test(body),raw+': missing fragment');
  }
  localLinks++;
 }
}
let materialized=null;
const flag=process.argv.indexOf('--materialize');
if(flag!==-1){
 assert.ok(process.argv[flag+1],'--materialize requires an empty output directory');
 materialized=path.resolve(process.argv[flag+1]);
 assert.ok(!fs.existsSync(materialized)||!fs.readdirSync(materialized).length,'materialization directory must be empty');
 fs.mkdirSync(materialized,{recursive:true});
 for(const [relative,bytes] of contents){const dest=path.join(materialized,relative);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);}
}
console.log(JSON.stringify({verified:true,packageFiles:manifest.files.length+1,sourceArtifacts:inventory.files.length,sourceManifestEntries,localLinks,deferredLocalLinks:[...new Set(deferredLocalLinks)],delegatedDirectories:manifest.delegatedDirectories,originalBytes:inventory.files.reduce((n,f)=>n+f.originalBytes,0),storedSourceBytes:inventory.files.reduce((n,f)=>n+f.storedBytes,0),materialized},null,2));
