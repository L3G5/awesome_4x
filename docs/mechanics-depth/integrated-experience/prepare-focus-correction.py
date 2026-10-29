from pathlib import Path
import subprocess
base=Path(__file__).parent
target=base/'candidate-focus-correction'
for folder in ['screens','text','exports','inputs','reviewed-sources']:
    (target/folder).mkdir(parents=True,exist_ok=True)
commit=subprocess.check_output(['git','rev-parse','94f41df'],text=True).strip()
helper=(base/'candidate-v023'/'common.mjs').read_text().replace('http://127.0.0.1:35515','http://127.0.0.1:41577').replace('fbd89a2e01f394676241ad6cfe868a0de095784a',commit)
(target/'common.mjs').write_text(helper)
for name in ['controlled-base.json','controlled-provenance.json']:
    (target/'inputs'/name).write_bytes((base/'inputs'/name).read_bytes())
with open('/tmp/experience-focus-correction-sources.tar','wb') as archive:
    subprocess.run(['git','archive',commit,'src','package.json'],stdout=archive,check=True)
subprocess.run(['tar','-xf','/tmp/experience-focus-correction-sources.tar','-C',str(target/'reviewed-sources')],check=True)
