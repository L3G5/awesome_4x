from pathlib import Path
import hashlib,html,json,re
root=Path(__file__).parent
def gallery(folder,title,summary,report,cards,links):
    p=root/folder
    body=''.join(f'<figure><a href="{name}.png"><img src="{name}.png" alt="{html.escape(caption)}" loading="lazy"></a><figcaption>{html.escape(caption)} · <a href="{name}.json">DOM/geometry</a></figcaption></figure>' for name,caption in cards)
    nav=''.join(f'<a href="{href}">{html.escape(label)}</a>' for href,label in links)
    text=html.escape((p/report).read_text())
    (p/'index.html').write_text(f'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(title)}</title><style>body{{margin:0;background:#0d1822;color:#dce7e9;font:16px/1.65 system-ui}}main{{max-width:1100px;margin:auto;padding:26px 20px}}h1{{color:#e5d3aa;line-height:1.3}}a{{color:#8edbd1}}nav{{display:flex;gap:16px;flex-wrap:wrap;margin:22px 0}}.gallery{{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}}figure{{margin:0;border:1px solid #456070;padding:12px;border-radius:10px}}img{{width:100%;height:390px;object-fit:contain;display:block;background:#08121c}}pre{{white-space:pre-wrap;font:14px/1.7 system-ui;overflow-wrap:anywhere;background:#142631;padding:20px}}</style><main><h1>{html.escape(title)}</h1><p>{html.escape(summary)}</p><nav>{nav}</nav><div class="gallery">{body}</div><pre>{text}</pre></main></html>')

gallery('','Mobile inspection: original reproduction and final acceptance','The original default-flow complaint was real. The final frozen candidate passes the bounded inspection, touch, Undo and focus corrections.','report.txt',[
 ('01-fresh-default','Original fresh campaign: scout selected without deliberate fleet choice.'),
 ('02-world-tap','Original world tap opens an incidental course card covering half the map.')
],[('corrected/final/index.html','Final acceptance'),('corrected/index.html','Intermediate failures'),('results.json','Original reproduction'),('build-pin.json','Original build/assets'),('archive-manifest.json','Complete archive hashes')])
gallery('corrected','Intermediate frozen review —2414a9b','Portrait behavior improved, but landscape controls, narrow toast placement and modal-Undo focus required corrections. Original attempts and the rounding recheck remain intact.','candidate-2414a9b-report.txt',[
 ('ru-640x390-ERROR','Inspector intercepts the original landscape Move touch.'),
 ('recheck-ru-320x844-turn','Original toast obscures the upper part of Undo.'),
 ('ru-390x844-modal','Menu header Undo itself fits and is reachable.')
],[('final/index.html','Final acceptance'),('results.json','Original attempts'),('bounded-recheck-results.json','320RU tolerance recheck'),('build-before.json','Build/assets'),('manifest.json','Evidence hashes')])
gallery('corrected/final','Final mobile/Undo acceptance —635e825','Four bounded actual-touch cases pass, plus one focused landscape touch-target confirmation. No remaining material issue was observed in this scope.','report.txt',[
 ('ru-390x844-world','Actual map tap remains compact world inspection.'),
 ('ru-640x390-move-touch','Landscape Move receives touch above the inspector boundary.'),
 ('ru-320x844-turn','Narrow End cycle/Undo fit; translated toast no longer covers Undo.'),
 ('ru-320x844-modal','Menu header Undo, language and Close fit at320px.'),
 ('ru-390x844-after-modal-undo','Modal Undo restores a visible focused Research heading.')
],[('report.txt','Report'),('results.json','Four cases'),('landscape-touch-results.json','Landscape hit target'),('build-before.json','Build/assets before'),('build-after.json','Build/assets after'),('manifest.json','Evidence hashes')])

# The supplemental landscape screenshot has its own focused geometry file.
p=root/'corrected/final/index.html'
p.write_text(p.read_text().replace('href="ru-640x390-move-touch.json"','href="landscape-touch-results.json"').replace('at320px','at 320px').replace('—635e825','— 635e825'))
def manifest(folder,name='manifest.json'):
    p=root/folder
    files=[]
    for f in sorted(p.rglob('*')):
        if f.is_file() and f!=p/name:
            d=f.read_bytes();files.append({'path':str(f.relative_to(p)),'bytes':len(d),'sha256':hashlib.sha256(d).hexdigest()})
    (p/name).write_text(json.dumps({'scope':'All files under this evidence folder, excluding this manifest itself.','files':files},indent=2)+'\n')
manifest('corrected/final');manifest('corrected');manifest('','archive-manifest.json')
for p in root.rglob('index.html'):
    for target in re.findall(r'(?:href|src)="([^"]+)"',p.read_text()):
        assert (p.parent/target).exists(),(p,target)
for folder,name in [('corrected/final','manifest.json'),('corrected','manifest.json'),('','archive-manifest.json')]:
    p=root/folder
    for row in json.loads((p/name).read_text())['files']:
        assert hashlib.sha256((p/row['path']).read_bytes()).hexdigest()==row['sha256']
final=root/'corrected/final'
assert (final/'build-before.json').read_bytes()==(final/'build-after.json').read_bytes()
r=json.loads((final/'results.json').read_text());assert len(r)==4 and all(x.get('pass') and not x['pageErrors'] for x in r)
print('Final cases4/4; all gallery links, build pins and archive hashes verified.')
