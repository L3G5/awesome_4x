import {browser,write,capture,snapshot,assert,fs,out,base} from './common.mjs';
const b=await browser(),context=await b.newContext({viewport:{width:1440,height:960},acceptDownloads:true,reducedMotion:'reduce'}),page=await context.newPage(),log=[],errors=[];page.on('pageerror',e=>errors.push(String(e)));
async function act(label,locator){await locator.click();const s=await snapshot(page);log.push({label,turn:s.turn,orders:s.factions.find(f=>f.id==='player').orders});write('natural-actions.json',log);return s;}
try{
 await page.goto(base);await page.locator('[data-action="begin"]').click();
 await act('Open campaign menu',page.locator('[data-action="menu"]'));
 await act('Begin a new campaign',page.locator('[data-action="new-game-menu"]'));
 await page.locator('#galaxy-seed').fill('LANE-EXPERIENCE-2');
 await act('Confirm deliberately selected seed LANE-EXPERIENCE-2',page.locator('[data-action="new-game-confirm"]'));
 await page.locator('[data-action="begin"]').click();
 write('inputs/natural-initial.json',await snapshot(page));await capture(page,'natural-01-opening');
 await act('Commission a lab at Solace',page.locator('[data-action="build-menu"]'));
 await act('Build lab',page.locator('[data-action="build"][data-item="lab"]'));
 await act('Open research',page.locator('[data-page="research"]'));
 await act('Research Deep-space Logistics',page.locator('[data-action="research"][data-tech="logistics"]'));
 await act('Return to Galaxy',page.locator('[data-page="galaxy"]'));
 let s=await snapshot(page);const ark=s.fleets.find(f=>f.owner==='player'&&f.type==='colony');
 await act('Select Colony Ark',page.locator(`#inspector [data-fleet="${ark.id}"]`));
 await act('Select already surveyed Iona from neighboring systems',page.locator('#inspector [data-system-select="s32"]').first());
 await act('Move ark to Iona',page.locator('[data-action="move"]'));
 await act('Review settlement',page.locator('[data-action="colonize"]'));
 await act('Settle Iona',page.locator('[data-action="colonize-confirm"]'));
 await capture(page,'natural-02-settled');
 await act('Open Iona construction',page.locator('[data-action="build-menu"]'));
 await act('Build Iona mineral extractor',page.locator('[data-action="build"][data-item="mine"]'));
 await act('Return home',page.locator('[data-action="home"]'));
 s=await snapshot(page);for(const fleet of s.fleets.filter(f=>f.owner==='player'&&f.systemId==='s0')){
  await act(`Select ${fleet.name}`,page.locator(`#inspector [data-fleet="${fleet.id}"]`));
  if(await page.locator('[data-action="hold"]').count())await act(`Hold ${fleet.name}`,page.locator('[data-action="hold"]'));
 }
 for(let i=0;i<12;i++){
  s=await snapshot(page);if(s.factions.find(f=>f.id==='player').techs.includes('logistics'))break;
  await act('End cycle; unused orders intentionally deferred',page.locator('#end-turn'));
  if(await page.locator('[data-action="end-turn-confirm"]').count())await act('Confirm end cycle',page.locator('[data-action="end-turn-confirm"]'));
  if(await page.locator('.modal').count()){log.push({label:'Read and dismiss cycle briefing/offer without changing a decision',turn:(await snapshot(page)).turn,text:await page.locator('.modal').innerText()});await page.keyboard.press('Escape');}
 }
 s=await snapshot(page);assert(s.factions.find(f=>f.id==='player').techs.includes('logistics'));
 await act('Compare colonies',page.locator('[data-page="empire"]'));
 await capture(page,'natural-03-colony-comparison');
 await act('Inspect Iona',page.locator('[data-colony-row="s32"] [data-action="inspect"]'));
 await capture(page,'natural-04-lane-on-map');
 await act('Review the natural lane opportunity',page.locator('.starlane-inspector [data-action="starlane-menu"]').first());
 await capture(page,'natural-05-restoration-decision');
 write('natural-decision.json',{synthetic:false,seedSelection:'Three seeds inspected only to choose an early naturally surveyed lane endpoint; all recorded play after new-campaign uses visible UI, no save injection or state edits.',turn:s.turn,world:s.systems.find(w=>w.id==='s32'),modal:await page.locator('.modal').innerText(),player:s.factions.find(f=>f.id==='player'),errors});
 await page.keyboard.press('Escape');write('inputs/natural-decision-save.json',await snapshot(page));
 await page.locator('[data-action="menu"]').click();const download=page.waitForEvent('download');await page.locator('[data-action="export"]').click();const d=await download;await d.saveAs(new URL('exports/natural-decision.json',out).pathname);
 write('natural-actions.json',log);
}catch(e){write('natural-error.json',{error:String(e),errors,log});await capture(page,'natural-ERROR');}
await context.close();await b.close();
