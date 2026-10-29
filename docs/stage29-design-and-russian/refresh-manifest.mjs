/** Rebuild this review subset's stored-byte inventory after an intentional docs edit. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const delegatedDirectories=['russian','acceptance'];
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
 const file=path.join(dir,entry.name),relative=path.relative(root,file);
 if(delegatedDirectories.some(part=>relative===part||relative.startsWith(part+'/')))return [];
 return entry.isDirectory()?walk(file):[file];
});
const files=walk(root).filter(file=>path.basename(file)!=='package-manifest.json').sort().map(file=>{
 const bytes=fs.readFileSync(file);return {path:path.relative(root,file),bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
});
fs.writeFileSync(path.join(root,'package-manifest.json'),JSON.stringify({packageBaseCommit:'c3bc8c48860bf036c46e601ba3198b0a689ddd4a',scope:'This review archive and its tools. Original report pins remain authoritative; integrated release reports are separate packages.',delegatedDirectories,deferredLocalLinks:['russian/index.html','acceptance/index.html'],files},null,2)+'\n');
console.log(JSON.stringify({files:files.length,bytes:files.reduce((n,file)=>n+file.bytes,0),delegatedDirectories},null,2));
