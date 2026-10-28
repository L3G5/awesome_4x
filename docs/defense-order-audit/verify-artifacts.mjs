import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const here=new URL('./',import.meta.url),hashes=JSON.parse(fs.readFileSync(new URL('hashes.json',here)));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const [file,hash]of Object.entries(hashes.artifacts))assert.equal(sha(fs.readFileSync(new URL(file,here))),hash,file);
for(const [file,hash]of Object.entries(hashes.externalReferences))assert.equal(sha(fs.readFileSync(new URL(file,here))),hash,file);
const html=fs.readFileSync(new URL('index.html',here),'utf8');let links=0;
for(const [,href]of html.matchAll(/href="([^"]+)"/g)){if(/^(?:https?:|#|data:)/.test(href))continue;assert.ok(fs.existsSync(new URL(href.split('#')[0],here)),href);links++;}
console.log(JSON.stringify({artifacts:Object.keys(hashes.artifacts).length,externalReferences:Object.keys(hashes.externalReferences).length,localLinks:links,valid:true}));
