import json
import os
import tempfile
import threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

ROOT=Path(__file__).resolve().parents[1]
DATA=Path(os.environ.get('IPA_OUTPUT_DIR', str(ROOT)))
seed=json.loads((ROOT/'catalog/2026-11-22-quality15.json').read_text())
LEGACY=json.loads((ROOT/'tests'/'legacy_v2_example.json').read_text())
HTML=(ROOT/'index.html').read_text()
STORE_POLY='''() => { const store = {}; Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>Object.hasOwn(store,k)?store[k]:null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>delete store[k],_dump:()=>({...store})}}) }'''
def initialize(page, saved=None):
    # Keep grading regression deterministic independently of external OAuth script availability.
    page.route('https://accounts.google.com/gsi/client',
               lambda route: route.fulfill(status=200,content_type='application/javascript',body=''))
    page.evaluate(STORE_POLY)
    if saved is not None: page.evaluate('(data)=>{for(const [k,v] of Object.entries(data))localStorage.setItem(k,v)}',saved)
    page.set_content(HTML,wait_until='domcontentloaded')
    return page

results=[]
errors=[]

def record(label, outcome, detail=''):
    results.append({'test':label,'result':'PASS' if outcome else 'FAIL', 'detail':detail})
    if not outcome: raise AssertionError(label+': '+detail)

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass

def bank_fixture():
    q=json.loads(json.dumps(seed['questions'][0]))
    q['question_id']='W27-A1-001'
    q['stem']='第2回のテスト専用。固定条件で採用する正しい対策を選ぶ。'
    q['question_version']='1.0.0'
    return {'bank_version':'ipa-test-followup-20261123-v1', 'display_name':'追加テスト問題集',
            'source_notice':'ブラウザテスト専用', 'audit_status':'構造テストのみ', 'questions':[q]}

def answer_set(page,part,bank=None,answers=None):
    if bank:
        page.locator(f'button[data-bank="{bank}"][data-section="{part}"]').first.click()
    else:
        page.locator(f'button[data-section="{part}"]').first.click()
    qs = [q for q in seed['questions'] if q['section']==part] if not bank else bank_fixture()['questions']
    for i,q in enumerate(qs):
        value = answers[i] if answers is not None else q['answer']
        page.locator(f'article[data-question-id="{q["question_id"]}"] input[value="{value}"]').check()
    return qs

def grade(page, count):
    page.locator('#submit-set').click()
    assert page.locator('#modal').is_visible()
    page.locator('[data-modal="yes"]').click()
    assert page.locator('#modal').is_hidden()
    assert f'採点完了' in page.locator('#notice').inner_text()
    assert page.evaluate('window.__IPA_APP_STATUS__.records')>=count

with tempfile.TemporaryDirectory() as tmp:
    class Handler(QuietHandler):
        def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(ROOT),**kwargs)
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    origin=f'http://127.0.0.1:{server.server_address[1]}/index.html'
    try:
        with sync_playwright() as pw:
            browser_path=os.environ.get('IPA_CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
            browser=pw.chromium.launch(headless=True,executable_path=browser_path,args=['--no-sandbox','--disable-dev-shm-usage'])
            context=browser.new_context(accept_downloads=True)
            page=context.new_page()
            page.add_init_script('''window.confirm=()=>{throw Error('native confirm banned')}; window.alert=()=>{throw Error('native alert banned')};window.prompt=()=>{throw Error('native prompt banned')};''')
            page.on('pageerror',lambda e:errors.append(str(e)))
            initialize(page)
            count=page.evaluate('window.__IPA_APP_STATUS__.banks')
            record('T1 完成HTML実体をset_contentで起動',count==1 and 'ローカル' in page.evaluate('window.__IPA_APP_STATUS__.catalogStatus'),str(page.evaluate('window.__IPA_APP_STATUS__')))
            record('標準確認ダイアログ非依存', not any(tag in (ROOT/'app.js').read_text() for tag in ('window.confirm(', 'window.alert(', 'window.prompt(')))
            page.locator('button[data-section="A1"]').first.click()
            qs=[q for q in seed['questions'] if q['section']=='A1']
            wrong = next(l for l in 'ABCD' if l!=qs[2]['answer'])
            values=['?','?',wrong]+[q['answer'] for q in qs[3:]]
            assert len(values)==10
            answer_set(page,'A1',answers=values)
            record('回答完了まで正答・解説非表示',page.locator('.explain').count()==0 and page.locator('#submit-set').is_enabled())
            page.locator('#submit-set').click()
            record('T2 採点ボタンでHTML内確認モーダル',page.locator('#modal').is_visible() and page.locator('#modal-message').inner_text().count('10問')>0)
            page.locator('[data-modal="no"]').click()
            record('T3 キャンセルでは採点せず回答保持',page.evaluate('window.__IPA_APP_STATUS__.records')==0 and page.locator('article.question input:checked').count()==10)
            grade(page,10)
            record('T4 10問採点とわからない別集計',page.evaluate('window.__IPA_APP_STATUS__.records')==10 and 'わからない' in page.locator('.metrics').inner_text() and '2' in page.locator('.metrics').inner_text())
            record('誤答と不明解説初期展開', page.locator('.explain details[open]').count()==3 and page.locator('.explain details:not([open])').count()==7)
            record('二重採点防止',page.locator('#submit-set').count()==0 and page.evaluate('window.__IPA_APP_STATUS__.records')==10)
            for part,total in [('A2',13),('B',15)]:
                answer_set(page,part)
                grade(page,total)
            record('3科目を独立採点',page.evaluate('window.__IPA_APP_STATUS__.attempts')==3 and page.evaluate('window.__IPA_APP_STATUS__.records')==15)
            page.locator('button[data-view="dashboard"]').first.click()
            record('T5 全履歴ダッシュボード・分野別・日付別', '15' in page.locator('.metrics').inner_text() and page.locator('svg[role="img"]').count()==1 and '科目別' in page.locator('#main').inner_text())
            page.screenshot(path=str(DATA/'IPA_SYSTEM_COMMON_APP_dashboard_preview.png'), full_page=True)
            page.locator('[data-schedule="exam"]').fill('2027-10-16')
            page.locator('[data-schedule="applicationFrom"]').fill('2027-08-01')
            page.locator('[data-schedule="applicationTo"]').fill('2027-08-31')
            record('公式試験日・申込期間グラフ表示', '試験日' in page.locator('svg').text_content() and '申込期間' in page.locator('svg').text_content())
            page.locator('#dashboard-mode').select_option('all')
            # Retake A1, history should append 10 records.
            page.locator('button[data-section="A1"]').first.click()
            page.locator('button[data-retry]').click()
            page.locator('[data-modal="no"]').click()
            record('再演習キャンセルで成績保持',page.evaluate('window.__IPA_APP_STATUS__.records')==15 and page.locator('.explain').count()==10)
            page.locator('button[data-retry]').click();page.locator('[data-modal="yes"]').click()
            answer_set(page,'A1',answers=['?']*10)
            grade(page,25)
            record('再演習の追記とわからない0点',page.evaluate('window.__IPA_APP_STATUS__.records')==25 and '10' in page.locator('.metrics').inner_text() and page.evaluate('window.__IPA_APP_STATUS__.attempts')==4)
            page.locator('button[data-view="dashboard"]').first.click()
            record('初見と全件の切替', '25' in page.locator('.metrics').inner_text())
            page.locator('#dashboard-mode').select_option('first')
            record('初見は15問のまま', '15' in page.locator('.metrics').inner_text())
            # Export JSON and verify full history.
            with page.expect_download() as dl:
                page.locator('button[data-export="1"]').first.click()
            download=dl.value;dest=Path(tmp)/'all-records.json';download.save_as(str(dest))
            obj=json.loads(dest.read_text())
            record('成績JSON出力と問題集の包含',len(obj['records'])==25 and len(obj['attempts'])==4 and len(obj['banks'])==1)
            # Fresh context import.
            ctx2=browser.new_context(accept_downloads=True);p2=ctx2.new_page();p2.on('pageerror',lambda e: errors.append(str(e)))
            initialize(p2);p2.locator('button[data-view="dashboard"]').first.click()
            p2.locator('button[data-import-records]').first.click();p2.set_input_files('#record-file',str(dest))
            p2.locator('[data-modal="yes"]').click()
            record('成績JSON復元',p2.evaluate('window.__IPA_APP_STATUS__.records')==25 and p2.evaluate('window.__IPA_APP_STATUS__.attempts')==4)
            p2.locator('button[data-import-records]').first.click();p2.set_input_files('#record-file',str(dest));p2.locator('[data-modal="yes"]').click()
            record('重複取込みの無重複',p2.evaluate('window.__IPA_APP_STATUS__.records')==25)
            # Tampered grade should not be accepted or change existing history.
            tampered=json.loads(dest.read_text());tampered['records'][0]['correct']=not tampered['records'][0]['correct']
            tampered_path=Path(tmp)/'tampered.json';tampered_path.write_text(json.dumps(tampered,ensure_ascii=False))
            p2.locator('button[data-import-records]').first.click();p2.set_input_files('#record-file',str(tampered_path))
            p2.wait_for_function("document.querySelector('#notice').textContent.includes('処理に失敗しました')")
            record('採点結果を改変したバックアップを拒否',p2.evaluate('window.__IPA_APP_STATUS__.records')==25 and '処理に失敗しました' in p2.locator('#notice').inner_text())
            # Fresh context import old v2 backup.
            ctx3=browser.new_context();p3=ctx3.new_page();initialize(p3)
            legacy_path=Path(tmp)/'legacy-v2.json';legacy_path.write_text(json.dumps(LEGACY,ensure_ascii=False))
            p3.locator('button[data-view="dashboard"]').first.click()
            p3.locator('button[data-import-records]').first.click();p3.set_input_files('#record-file',str(legacy_path));p3.locator('[data-modal="yes"]').click()
            record('95問v2形式の旧成績取込み',p3.evaluate('window.__IPA_APP_STATUS__.records')==10)
            # External bank import
            extra=bank_fixture();fixture=Path(tmp)/'followup.json';fixture.write_text(json.dumps(extra,ensure_ascii=False))
            p2.locator('button[data-view="library"]').first.click();p2.locator('#add-bank').click();p2.set_input_files('#bank-file',str(fixture));p2.locator('[data-modal="yes"]').click()
            record('新規問題集JSONの追加',p2.evaluate('window.__IPA_APP_STATUS__.banks')==2)
            collision=json.loads(json.dumps(extra));collision['questions'][0]['answer']='A' if collision['questions'][0]['answer']!='A' else 'B'
            collision_file=Path(tmp)/'collision.json';collision_file.write_text(json.dumps(collision,ensure_ascii=False))
            p2.locator('#add-bank').click();p2.set_input_files('#bank-file',str(collision_file))
            p2.wait_for_function("document.querySelector('#notice').textContent.includes('処理に失敗しました')")
            record('同一bank_versionの内容差分を拒否',p2.evaluate('window.__IPA_APP_STATUS__.banks')==2 and '処理に失敗しました' in p2.locator('#notice').inner_text())
            answer_set(p2,'A1',bank=extra['bank_version']);grade(p2,26)
            record('別問題集の採点記録追記',p2.evaluate('window.__IPA_APP_STATUS__.records')==26)
            # A new page and explicit store transfer simulates rehydration of saved localStorage.
            stored=p2.evaluate('localStorage._dump()')
            p2_again=ctx2.new_page();initialize(p2_again,stored)
            record('T6 模擬保存データからの復元',p2_again.evaluate('window.__IPA_APP_STATUS__.records')==26 and p2_again.evaluate('window.__IPA_APP_STATUS__.banks')==2)
            p2_again.close()
            # HTTP route is blocked by host administrator policy; inspect the real manifest schema and data path instead.
            manifest=json.loads((ROOT/'catalog/manifest.json').read_text())
            record('公開カタログ構造と実ファイル整合',manifest['schema_version']=='ipa-study-catalog-manifest-v1' and all((ROOT/entry['file']).exists() for entry in manifest['banks']))
            # Test old localStorage migration if previous data was present (new same-origin).
            legacy15=json.loads((ROOT/'tests'/'legacy_15_example.json').read_text())
            ctx4=browser.new_context();p4=ctx4.new_page()
            store={'ipa-systems-quality-test-15q-v1-records':json.dumps(legacy15,ensure_ascii=False)}
            initialize(p4,store)
            record('旧15問アプリの同一オリジン保存からの移行',p4.evaluate('window.__IPA_APP_STATUS__.records')>=15)
            # Corrupted primary storage must not be overwritten by hydration.
            ctx5=browser.new_context();p5=ctx5.new_page()
            corrupt='{\"schema_version\":\"incorrect-version\",\"records\":[]}'
            initialize(p5,{'ipa-system-unified-study-v1':corrupt})
            record('破損済みの永続記録は自動上書きしない',p5.evaluate('localStorage.getItem(\"ipa-system-unified-study-v1\")')==corrupt)
            ctx5.close()
            record('ブラウザJavaScript例外が0件',len(errors)==0,'; '.join(errors))
            ctx4.close();ctx3.close();ctx2.close();context.close();browser.close()
    finally:
        server.shutdown();server.server_close()

report={'environment':'Playwright headless Chromium using set_content of exact released HTML; browser native confirm/alert/prompt overridden to throw in primary workflow; localStorage memory-backed mock; HTTP/file URLs blocked by host administrator policy',
        'total':len(results),'passed':sum(t['result']=='PASS' for t in results),'failed':sum(t['result']=='FAIL' for t in results),
        'tests':results,'page_errors':errors,
        'not_verified':['Opening local downloaded HTML or localhost in real Chrome (environment network/file navigation blocked)','Real native localStorage persistence after full Chrome restart (tested with mock and state transfer)','Remote GitHub Pages manifest fetch and automatic GitHub commits','Automatic cross-device cloud record sync']}
(DATA/'IPA_SYSTEM_COMMON_APP_QA_v1.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print('PASS:',report['passed'],'/',report['total'])
for t in results: print(t['result'],t['test'])
