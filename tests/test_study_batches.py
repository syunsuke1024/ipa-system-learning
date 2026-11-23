"""95問の通常学習を小セット採点するE2E回帰テスト。本番模試の途中採点は禁止。"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / 'index.html').read_text(encoding='utf-8')
BANK = json.loads((ROOT / 'catalog/2026-11-23-full95-v4.json').read_text(encoding='utf-8'))
VERSION = BANK['bank_version']
SEED = json.loads((ROOT / 'catalog/2026-11-22-quality15.json').read_text(encoding='utf-8'))
STORAGE = 'ipa-system-unified-study-v1'
counts = {'A1':[10,10,10,10,10,10], 'A2':[8,8,7], 'B':[4,4,4]}

def initialize(page, saved=None):
    page.route('https://accounts.google.com/gsi/client',
               lambda route: route.fulfill(status=200, content_type='application/javascript', body=''))
    page.add_init_script('''window.confirm=()=>{throw Error("native confirm banned")};
      window.alert=()=>{throw Error("native alert banned")};
      window.prompt=()=>{throw Error("native prompt banned")};''')
    page.evaluate('''() => {const store={};Object.defineProperty(window,'localStorage',{
      configurable:true,value:{getItem:k=>Object.hasOwn(store,k)?store[k]:null,
      setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>delete store[k]}})}''')
    if saved is not None:
        page.evaluate('(s) => localStorage.setItem("'+STORAGE+'",s)', saved)
    page.set_content(HTML, wait_until='domcontentloaded')
    return page

def select_section(page, part):
    page.locator(f'button[data-bank="{VERSION}"][data-section="{part}"]').first.click()

def fill_block(page, qs, answer_override=None):
    for q in qs:
        answer = answer_override if answer_override is not None else q['answer']
        page.locator(f'article[data-question-id="{q["question_id"]}"] input[value="{answer}"]').check()

def confirm_grade(page, total):
    assert page.locator('#submit-set').is_enabled()
    page.locator('#submit-set').click()
    assert page.locator('#modal').is_visible()
    page.locator('button[data-modal="yes"]').click()
    assert page.locator('#modal').is_hidden()
    assert page.evaluate('window.__IPA_APP_STATUS__.records') == total

errors=[]
with sync_playwright() as pw:
    binary=os.environ.get('IPA_CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
    browser=pw.chromium.launch(headless=True,executable_path=binary,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page()
    page.on('pageerror',lambda e:errors.append(str(e)))
    initialize(page)
    page.locator('button[data-view="library"]').first.click()
    page.locator('button[data-import-bank="1"]').click()
    page.locator('#bank-file').set_input_files(files=[{
        'name':'real-95.json','mimeType':'application/json',
        'buffer':json.dumps(BANK,ensure_ascii=False).encode('utf-8')}])
    assert page.locator('#modal').is_visible()
    page.locator('button[data-modal="yes"]').click()
    select_section(page,'A1')
    assert page.locator('article.question').count()==10
    assert '第1/6セット' in page.locator('#main').inner_text()
    assert page.locator('button[data-study-block="1"]').first.is_disabled()
    a1=[q for q in BANK['questions'] if q['section']=='A1']
    fill_block(page,a1[:10])
    page.locator('#submit-set').click()
    assert page.locator('#modal').is_visible()
    page.locator('button[data-modal="no"]').click()
    assert page.evaluate('window.__IPA_APP_STATUS__.records')==0
    assert page.locator('article.question input:checked').count()==10
    confirm_grade(page,10)
    assert page.locator('.explain').count()==10
    assert page.locator('button[data-study-block="1"]').first.is_enabled()
    assert page.locator('#submit-set').count()==0
    page.locator('button[data-study-block="1"]').first.click()
    assert '第2/6セット' in page.locator('#main').inner_text()
    assert page.locator('article.question').count()==10
    assert page.locator('.explain').count()==0
    assert page.locator('article.question').first.get_attribute('data-question-id')==a1[10]['question_id']
    fill_block(page,a1[10:20]);confirm_grade(page,20)
    saved=page.evaluate('localStorage.getItem("'+STORAGE+'")')
    stored=json.loads(saved)
    assert stored['attempts'][-1]['study_block_index']==1
    assert stored['attempts'][-1]['total']==10
    assert stored['studyPages'][VERSION+'::A1']==1
    # New browser state restores the selected second block with no duplicate grades.
    restored=browser.new_page();restored.on('pageerror',lambda e:errors.append(str(e)))
    initialize(restored,saved)
    assert restored.evaluate('window.__IPA_APP_STATUS__.records')==20
    assert restored.locator('article.question').count()==10
    assert restored.locator('.explain').count()==10
    assert '第2/6セット' in restored.locator('#main').inner_text()
    # Complete remaining A1 batches.
    total=20
    for i in range(2,6):
        restored.locator(f'button[data-study-block="{i}"]').first.click()
        assert restored.locator('article.question').count()==10
        fill_block(restored,a1[i*10:(i+1)*10])
        total+=10;confirm_grade(restored,total)
    assert total==60
    # A2: 8 + 8 + 7, B: 4 + 4 + 4.
    for part in ['A2','B']:
        select_section(restored,part)
        qs=[q for q in BANK['questions'] if q['section']==part]
        at=0
        for i,size in enumerate(counts[part]):
            assert restored.locator('article.question').count()==size
            assert f'第{i+1}/{len(counts[part])}セット' in restored.locator('#main').inner_text()
            fill_block(restored,qs[at:at+size])
            at+=size;total+=size;confirm_grade(restored,total)
            if i<len(counts[part])-1:
                restored.locator(f'button[data-study-block="{i+1}"]').first.click()
        assert at==len(qs)
    assert total==95
    data=json.loads(restored.evaluate('localStorage.getItem("'+STORAGE+'")'))
    assert len(data['attempts'])==12
    assert [a['total'] for a in data['attempts']]==[10]*6+[8,8,7]+[4]*3
    assert all(a['mode']=='learning' for a in data['attempts'])
    assert len({r['record_id'] for r in data['records']})==95
    assert all(r['is_first_seen'] for r in data['records'])
    # Retake ONLY the first 10-question batch without deleting other grades.
    select_section(restored,'A1')
    restored.locator('button[data-study-block="0"]').first.click()
    restored.locator('button[data-retry]').click()
    assert restored.locator('#modal').is_visible()
    restored.locator('button[data-modal="no"]').click()
    assert restored.evaluate('window.__IPA_APP_STATUS__.records')==95
    restored.locator('button[data-retry]').click()
    restored.locator('button[data-modal="yes"]').click()
    assert restored.locator('article.question').count()==10
    assert restored.locator('.explain').count()==0
    fill_block(restored,a1[:10],answer_override='?')
    confirm_grade(restored,105)
    data=json.loads(restored.evaluate('localStorage.getItem("'+STORAGE+'")'))
    assert len(data['attempts'])==13
    assert data['attempts'][-1]['total']==10
    assert all(not r['is_first_seen'] for r in data['records'][-10:])
    assert all(r['unknown'] and not r['correct'] for r in data['records'][-10:])
    assert len({r['record_id'] for r in data['records']})==105
    # Original 15q set must stay unsplit.
    restored.locator('button[data-bank="'+SEED['bank_version']+'"][data-section="A1"]').first.click()
    assert restored.locator('article.question').count()==10
    assert restored.locator('button[data-study-block]').count()==0
    assert not errors,errors
    browser.close()
print('PASS learning batches: A1 10x6, A2 8+8+7, B 4x3, 95 records/12 attempts, cancel, resume, retake, legacy15, no dialogs')
