"""E2E acceptance with actual audited candidate bank, not the synthetic 95-row fixture."""
from pathlib import Path
import json,os
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
BANK=json.loads((ROOT/'catalog/2026-11-23-full95-v4.json').read_text())
HTML=(ROOT/'index.html').read_text()
assert {x:sum(q['section']==x for q in BANK['questions']) for x in ['A1','A2','B']}=={'A1':60,'A2':23,'B':12}
with sync_playwright() as pw:
    bp=os.environ.get('IPA_CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
    b=pw.chromium.launch(headless=True,executable_path=bp,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=b.new_page(viewport={'width':1440,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.add_init_script('window.confirm=()=>{throw Error("native confirm called")}; window.alert=()=>{throw Error("native alert called")}; window.prompt=()=>{throw Error("native prompt called")};')
    page.evaluate('''() => { const store={};Object.defineProperty(window,"localStorage",{configurable:true,value:{getItem:k=>Object.hasOwn(store,k)?store[k]:null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>delete store[k]}}) }''')
    page.set_content(HTML,wait_until="domcontentloaded")
    page.locator('button[data-view="library"]').first.click()
    page.locator('button[data-import-bank="1"]').click()
    page.locator('#bank-file').set_input_files(files=[{'name':'verified-candidate.json','mimeType':'application/json','buffer':json.dumps(BANK,ensure_ascii=False).encode()}])
    page.locator('button[data-modal="yes"]').click()
    page.locator(f'button[data-mock-start="{BANK["bank_version"]}"]').click()
    part1=[q for q in BANK['questions'] if q['section']=='A1']
    part2=[q for q in BANK['questions'] if q['section'] in ['A2','B']]
    assert page.locator('input[data-mock-answer]').count()==300
    assert page.get_by_text('正解：',exact=False).count()==0
    # Actual correct choices for all A1, except one intentionally unknown and one intentionally wrong.
    choices=[]
    for i,q in enumerate(part1):
        ans=q['answer'] if i>=2 else ('?' if i==0 else next(a for a in 'ABCD' if a!=q['answer']))
        choices.append({'id':q['question_id'],'answer':ans})
    result=page.evaluate('''qs=>{ for(const q of qs){const inputs=[...document.querySelectorAll('input[data-mock-answer]')];const el=inputs.find(e=>e.dataset.mockAnswer===q.id&&e.value===q.answer);if(!el)return q.id; el.click();}return 'ok';}''',choices)
    assert result=='ok',result
    assert '60/60問回答済み' in page.locator('main').inner_text()
    page.locator('button[data-mock-phase]').click();page.locator('button[data-modal="no"]').click()
    assert page.evaluate('window.__IPA_APP_STATUS__.records')==0
    page.locator('button[data-mock-phase]').click();page.locator('button[data-modal="yes"]').click()
    assert page.locator('input[data-mock-answer]').count()==175
    assert page.get_by_text('正解：',exact=False).count()==0
    choices=[{'id':q['question_id'],'answer':q['answer']} for q in part2]
    result=page.evaluate('''qs=>{ for(const q of qs){const inputs=[...document.querySelectorAll('input[data-mock-answer]')];const el=inputs.find(e=>e.dataset.mockAnswer===q.id&&e.value===q.answer);if(!el)return q.id; el.click();}return 'ok';}''',choices)
    assert result=='ok',result
    page.locator('button[data-mock-finalize]').click();page.locator('button[data-modal="yes"]').click()
    assert page.evaluate('window.__IPA_APP_STATUS__.records')==95
    assert page.evaluate('window.__IPA_APP_STATUS__.attempts')==3
    assert '93/95' in page.locator('main').inner_text()
    assert page.get_by_text('正解：',exact=False).count()==95
    data=json.loads(page.evaluate('localStorage.getItem("ipa-system-unified-study-v1")'))
    assert len(data['records'])==95 and len(data['attempts'])==3
    assert sum(r['correct'] for r in data['records'])==93
    assert sum(r['unknown'] for r in data['records'])==1
    assert all(r['mode']=='mock' for r in data['records'])
    assert {x:len([r for r in data['records'] if r['section']==x]) for x in ['A1','A2','B']}=={'A1':60,'A2':23,'B':12}
    assert set(r['bank_version'] for r in data['records'])=={BANK['bank_version']}
    assert len(set(r['record_id'] for r in data['records']))==95
    assert not errors,errors
    print('PASS: REAL 95-bank mock exam (60/23/12), 93 correct, 1 wrong, 1 unknown, no answers leaked, no standard dialogs, 95 records + 3 attempts')
    b.close()
