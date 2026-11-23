"""Regression: retire <95 study banks/records while preserving all 95q learning grades."""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'index.html').read_text(encoding='utf-8')
FULL=json.loads((ROOT/'catalog/2026-11-23-full95-v4.json').read_text(encoding='utf-8'))
SHORT=json.loads((ROOT/'catalog/2026-11-22-quality15.json').read_text(encoding='utf-8'))
PREF='ipa-system-unified-study-v1'
DATE='2026-11-23'
TIMESTAMP='2026-11-23T12:00:00+09:00'
def record(q,version,ident,attempt):
    return {'record_id':ident,'attempt_id':attempt,'bank_version':version,'question_id':q['question_id'],
      'question_version':q['question_version'],'section':q['section'],'major':q['major'],'minor':q['minor'],
      'difficulty':q['difficulty'],'answer':q['answer'],'correct':True,'unknown':False,
      'mode':'learning','is_first_seen':True,'answered_at':TIMESTAMP,'submitted_at':TIMESTAMP,
      'answer_date':DATE,'elapsed_seconds':20}
full_records=[]
full_attempts=[]
for section,sections in [('A1',[10]*6),('A2',[8,8,7]),('B',[4]*3)]:
    qs=[q for q in FULL['questions'] if q['section']==section]
    at=0
    for i,size in enumerate(sections):
        aid=f'fixture95_{section}_{i:02d}_20261123'
        for q in qs[at:at+size]:
            full_records.append(record(q,FULL['bank_version'],f'full95_{q["question_id"]}_record',aid))
        at+=size
        full_attempts.append({'attempt_id':aid,'bank_version':FULL['bank_version'],'section':section,
            'submitted_at':TIMESTAMP,'answer_date':DATE,'total':size,'correct':size,'unknown':0,
            'mode':'learning','study_block_index':i,'study_block_count':len(sections)})
assert len(full_records)==95 and len(full_attempts)==12
short_records=[]
for i,q in enumerate(SHORT['questions'][:2]):
    short_records.append(record(q,SHORT['bank_version'],f'retired_record_{i}_20261123','retired_attempt_20261123'))
short_attempts=[{'attempt_id':'retired_attempt_20261123','bank_version':SHORT['bank_version'],
  'section':'A1','submitted_at':TIMESTAMP,'answer_date':DATE,'total':2,'correct':2,'unknown':0,'mode':'learning'}]
state={'schema_version':'ipa-unified-study-1','banks':{FULL['bank_version']:FULL},
  'records':short_records+full_records,'attempts':short_attempts+full_attempts,
  'drafts':{},'mockSessions':{},'studyPages':{},'selectedBank':SHORT['bank_version'],
  'selectedSection':'A1','view':'library','dashboardMode':'first','dashboardExamMode':'learning',
  'dashboardBank':'all','dashboardSection':'all','reportMajor':'all','catalogStatus':'過去のキャッシュ',
  'schedule':{'exam':'','applicationFrom':'','applicationTo':''}}

with sync_playwright() as pw:
    executable=os.environ.get('IPA_CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
    browser=pw.chromium.launch(headless=True,executable_path=executable,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page();errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('https://accounts.google.com/gsi/client',
      lambda route:route.fulfill(status=200,content_type='application/javascript',body=''))
    page.add_init_script('window.confirm=()=>{throw Error("standard confirm banned")};window.alert=()=>{throw Error("standard alert banned")};window.prompt=()=>{throw Error("standard prompt banned")}')
    page.evaluate('''(state)=>{const map={};map["ipa-system-unified-study-v1"]=JSON.stringify(state);
      Object.defineProperty(window,"localStorage",{configurable:true,value:{
        getItem:k=>map[k]??null,setItem:(k,v)=>{map[k]=String(v)},removeItem:k=>delete map[k]}})}''',state)
    page.set_content(HTML,wait_until='domcontentloaded')
    assert page.evaluate('window.__IPA_APP_STATUS__.banks')==1
    assert page.evaluate('window.__IPA_APP_STATUS__.records')==95
    assert page.evaluate('window.__IPA_APP_STATUS__.attempts')==12
    assert page.locator(f'button[data-bank="{SHORT["bank_version"]}"]').count()==0
    assert page.locator(f'button[data-bank="{FULL["bank_version"]}"]').count()>0
    raw=json.loads(page.evaluate('localStorage.getItem("'+PREF+'")'))
    assert len(raw['records'])==95 and len(raw['attempts'])==12
    assert all(r['bank_version']==FULL['bank_version'] for r in raw['records'])
    assert raw['selectedBank']==FULL['bank_version']
    page.locator('button[data-view="dashboard"]').first.click()
    assert '95問セット別の結果' in page.locator('main').inner_text()
    assert '累計正答率は表示しません' in page.locator('main').inner_text()
    assert page.locator('.metric').filter(has_text='正答率').count()==0
    assert '95/95' in page.locator('main').inner_text()
    assert 'LIFETIME' not in page.locator('main').inner_text()
    # Reload with the migrated local store; retired records must never return.
    saved=page.evaluate('localStorage.getItem("'+PREF+'")')
    page2=browser.new_page()
    page2.route('https://accounts.google.com/gsi/client',
      lambda route:route.fulfill(status=200,content_type='application/javascript',body=''))
    page2.evaluate('''(payload)=>{const map={"ipa-system-unified-study-v1":payload};
      Object.defineProperty(window,"localStorage",{configurable:true,value:{
        getItem:k=>map[k]??null,setItem:(k,v)=>{map[k]=String(v)},removeItem:k=>delete map[k]}})}''',saved)
    page2.set_content(HTML,wait_until='domcontentloaded')
    assert page2.evaluate('window.__IPA_APP_STATUS__.records')==95
    assert page2.evaluate('window.__IPA_APP_STATUS__.banks')==1
    assert not errors,errors
    browser.close()
print('PASS: short practice data retired locally; 95 records/12 attempts retained; per-bank dashboard has no lifetime accuracy')
