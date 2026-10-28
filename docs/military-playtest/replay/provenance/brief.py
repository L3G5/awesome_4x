import json,sys
x=json.load(sys.stdin)
if 'error' in x: print(json.dumps(x)); sys.exit()
v=x.get('view') or {}
print(json.dumps({'dom':x.get('dom','')[-3500:],'faction':v.get('faction'),'worlds':[{'id':w['id'],'name':w['name'],'population':w['population'],'buildings':w['buildings'],'queue':w.get('queue')} for w in v.get('owned',[])],'new':v.get('newOrChangedWorlds'),'fleets':v.get('fleets'),'races':v.get('publicRaces')},ensure_ascii=False))
