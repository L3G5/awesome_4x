import fs from 'node:fs';
import path from 'node:path';
import { parseAst } from 'rollup/parseAst';
const output=process.argv[2] || '/tmp/asterion-localization-inventory/raw.json';
const values=[];
function alternatives(node){
 if(node?.type==='Literal' && typeof node.value==='string')return [node.value];
 if(node?.type==='ConditionalExpression'){
  const a=alternatives(node.consequent),b=alternatives(node.alternate);if(a&&b)return [...a,...b];
 }
 return null;
}
function describe(node,source){
 const options=alternatives(node);if(options)return {kind:'enum',options};
 if(node?.type==='CallExpression' && node.callee?.type==='Identifier' && ['escape','esc'].includes(node.callee.name))return describe(node.arguments[0],source);
 const code=source.slice(node.start,node.end);
 if(/\b(?:reason|message|detail|explanation|summary|description|text|note|suffix|benefits|effect)\b/i.test(code))return {kind:'text'};
 if(/\.map\(|\.join\(/.test(code))return {kind:'list'};
 if(/(?:\.name|\.shortName|\.role|\.label|\.title)\b|^(?:name|label|role|factionName|systemName)$/.test(code))return {kind:'name'};
 if(/(?:\bMath\.|\b(?:num|signed|formatHull)\(|\.length\b|\.toFixed\(|\.padStart\(|(?:^|\.)(?:turn|expiresTurn|createdTurn|truceTurns|credits|minerals|science|orders|population|capacity|production|upkeep|ships|hp|movesLeft|jumps|progress|target|beacons|cost|damage|round|rounds|count|total|amount|income|work|cycles|turns|current|completed|hullAfter|retaliation|hit|volley|firepower|defense|defenseAfter|habitability|richness)\b)/i.test(code))return {kind:'number'};
 return {kind:'fragment'};
}
function walk(node,file,source){
 if(!node || typeof node!=='object')return;
 if(node.type==='Literal' && typeof node.value==='string')values.push({file,value:node.value});
 if(node.type==='TemplateLiteral')values.push({file,value:node.quasis.map((q,i)=>(q.value.cooked??q.value.raw)+(i<node.expressions.length?`{${i}}`:'')).join(''),bindings:node.expressions.map(e=>describe(e,source))});
 for(const [key,value] of Object.entries(node)){
  if(key==='parent')continue;
  if(Array.isArray(value))value.forEach(child=>walk(child,file,source));
  else if(value && typeof value==='object')walk(value,file,source);
 }
}
for(const file of fs.readdirSync('src').filter(n=>n.endsWith('.js')&&!n.startsWith('localization'))){const source=fs.readFileSync(path.join('src',file),'utf8');walk(parseAst(source),file,source);}
fs.writeFileSync(output,JSON.stringify(values,null,2)+'\n');
