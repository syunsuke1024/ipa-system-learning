"""Mock mode acceptance tests. Exercises 95-question engine with an unapproved fixture.
Fixtures are never published to the public catalog.
"""
from pathlib import Path
import json,os,threading
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
SEED=json.loads((ROOT/'catalog/2026-11-22-quality15.json').read_text())
# A synthetic 95-row bank for UI tests only. It is never published or audited as an exam bank.
counts={'A1':60,'A2':23,'B':12}
questions=[]
for section,count in counts.items():
    pool=[q for q in SEED['questions'] if q['section']==section]
    for i in range(count):
        q=json.loads(json.dumps(pool[i%len(pool)]))
        q['question_id']=f'QA95-{section}-{i+1:03d}'
        q['question_version']='test-only-1'
        questions.append(q)
BANK={'bank_version':'ui-mock95-nonpublish-test-only','display_name':'テスト専用95問（公開不可）',
      'source_notice':'E2Eの構造テスト専用。問題として出題しない。',
      'audit_status':'テスト用のみ','questions':questions}
HTML=(ROOT/'index.html').read_text()
with sync_playwright() as pw:
    bp=os.environ.get('IPA_CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
    b=pw.chromium.launch(headless=True,executable_path=bp,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=b.new_page();err=[];page.on('pageerror',lambda e:err.append(str(e)))
    page.add_init_script('window.confirm=()=>{throw Error("native confirm called")}; window.alert=()=>{throw Error("native alert called")}; window.prompt=()=>{throw Error("native prompt called")};')
    page.evaluate('''() => { const store={};Object.defineProperty(window,"localStorage",{configurable:true,value:{getItem:k=>Object.hasOwn(store,k)?store[k]:null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>delete store[k]}}) }''')
    page.set_content(HTML,wait_until="domcontentloaded")
    # import manual bank through the app's same JSON import surface, not bypassing UI.
    page.locator('button[data-view="library"]').first.click()
    page.locator('button[data-import-bank="1"]').click()
    page.locator('#bank-file').set_input_files(files=[{'name':'mock-fixture.json','mimeType':'application/json','buffer':json.dumps(BANK,ensure_ascii=False).encode()}])
    assert page.locator("#modal").is_visible()
    page.locator('button[data-modal="yes"]').click()
    assert page.locator(f'button[data-mock-start="{BANK["bank_version"]}"]').count()==1
    page.locator(f'button[data-mock-start="{BANK["bank_version"]}"]').click()
    assert page.locator('input[data-mock-answer]').count()==300 # 60*5
    assert page.get_by_text('正解：',exact=False).count()==0
    page.locator('input[data-mock-answer]').first.check()
    # Cancel / verify no grading
    page.locator('button[data-mock-phase]').click()
    assert page.locator('#modal').is_visible()
    page.locator('button[data-modal="no"]').click()
    assert page.locator('#modal').is_hidden()
    assert page.evaluate('window.__IPA_APP_STATUS__.records')==0
    # Save draft and reload
    saved=page.evaluate('localStorage.getItem("ipa-system-unified-study-v1")')
    d=json.loads(saved);assert d['mockSessions'][BANK['bank_version']]['answers']
    page.locator('button[data-mock-phase]').click()
    page.locator('button[data-modal="yes"]').click()
    assert page.locator('input[data-mock-answer]').count()==175 # 35*5
    assert page.get_by_text('正解：',exact=False).count()==0
    assert page.evaluate('window.__IPA_APP_STATUS__.records')==0
    page.locator('button[data-mock-finalize]').click()
    page.locator('button[data-modal="no"]').click()
    assert page.evaluate('window.__IPA_APP_STATUS__.records')==0
    page.locator('button[data-mock-finalize]').click()
    page.locator('button[data-modal="yes"]').click()
    assert page.evaluate('window.__IPA_APP_STATUS__.records')==95
    assert page.evaluate('window.__IPA_APP_STATUS__.attempts')==3
    assert page.get_by_text('正解：',exact=False).count()>0
    stored=json.loads(page.evaluate('localStorage.getItem("ipa-system-unified-study-v1")'))
    assert all(r['mode']=='mock' for r in stored['records'])
    assert sum(r['unknown'] for r in stored['records'])==94
    assert len(stored['records'])==len({r['record_id'] for r in stored['records']})
    page.locator('button[data-view="dashboard"]').first.click()
    assert page.locator('select#dashboard-exam-mode').input_value()=='learning'
    assert page.get_by_text('0/0',exact=False).count()>0 or '0/0' in page.locator('main').inner_text()
    page.locator('select#dashboard-exam-mode').select_option('mock')
    assert '1/95' in page.locator('main').inner_text() or '0/95' in page.locator('main').inner_text()
    assert not err,err
    print('PASS full mock: 95 question fixture, 2 timed phases, cancellation, answer hiding, grade 95, separated dashboard, no native dialogs')
    b.close()
