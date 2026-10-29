"""Preserve source interpolation types when matching canonical rendered messages."""
from pathlib import Path
from html.parser import HTMLParser
import json,re,sys
class Parts(HTMLParser):
 def __init__(self):super().__init__(convert_charrefs=True);self.parts=[]
 def handle_data(self,data):self.parts.append(data)
 def handle_starttag(self,tag,attrs):self.parts.extend(v for k,v in attrs if k in ['title','aria-label','placeholder','alt'] and v)
source=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/asterion-localization-inventory/raw.json')
catalog=Path('src/locales/ru.js').read_text();catalog=json.loads(catalog.split('export const russian = ',1)[1].rstrip().rstrip(';'))
bindings={}
for row in json.loads(source.read_text()):
 if not row.get('bindings'):continue
 value=row['value']
 if re.search(r'<[a-z]',value) and '>' in value:
  p=Parts();p.feed(value);parts=p.parts
 else:parts=[value]
 for part in parts:
  part=re.sub(r'\s+',' ',part).strip()
  if part not in catalog:continue
  record={slot:row['bindings'][int(slot)] for slot in re.findall(r'\{(\d+)\}',part)}
  if record and record not in bindings.setdefault(part,[]):bindings[part].append(record)
overrides=Path('src/locales/slot-overrides.json')
if overrides.exists():
 for key,shape in json.loads(overrides.read_text()).items():
  if key in catalog:bindings[key]=[shape]
Path('src/locales/bindings.js').write_text('// Generated from original template expressions; never reads campaign state.\nexport const bindings = '+json.dumps(bindings,ensure_ascii=False,indent=2)+';\n')
print('Bound template shapes:',len(bindings))
