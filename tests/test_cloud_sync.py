"""OAuth and Sheets requests are mocked; no real Google account is touched.
Exercises the exact generated index.html with native dialogs disabled."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'index.html').read_text(encoding='utf-8')
SEED=json.loads((ROOT/'catalog/2026-11-22-quality15.json').read_text())
CLIENT='123456789-testclient.apps.googleusercontent.com'
SHEET='sheetMock1234567890123456'
POLY='''() => {let data={};Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>data[k]??null,setItem:(k,v)=>data[k]=String(v),removeItem:k=>delete data[k],_dump:()=>({...data})}});}'''
FAKE='''(initial)=>{
  const head=['kind','id','attempt_id','bank_version','question_id','question_version','section','major','minor','difficulty','answer','correct','unknown','mode','is_first_seen','answered_at','submitted_at','answer_date','elapsed_seconds','payload_json'];
  window.__cloudMock={rows:initial.rows||[],requests:[],failAppend:false,failAfterAppend:false};
  window.google={accounts:{oauth2:{initTokenClient:params=>({requestAccessToken:opts=>params.callback({access_token:'test-access-token',expires_in:3600})})}}};
  const response=(data,status=200)=>({ok:status===200,status,json:async()=>data});
  const regularFetch=window.fetch;
  window.fetch=async (u,o={})=>{
    const url=String(u);if(!url.startsWith('https://sheets.googleapis.com/'))return regularFetch(u,o);
    window.__cloudMock.requests.push({url,method:o.method||'GET'});
    if(window.__cloudMock.failAppend&&url.includes(':append'))return response({error:{message:'Injected failure'}},503);
    if(url.endsWith('/v4/spreadsheets')&&o.method==='POST')return response({spreadsheetId:'sheetMock1234567890123456'});
    if(url.includes('/values:batchUpdate'))return response({totalUpdatedCells:22});
    if(url.includes('/values:batchGet'))return response({valueRanges:[{values:[['schema_version','ipa-study-cloud-log-v1']]},{values:[head]}]});
    if(url.includes(':append')){
      const rows=JSON.parse(o.body).values;window.__cloudMock.rows.push(...rows);
      if(window.__cloudMock.failAfterAppend){window.__cloudMock.failAfterAppend=false;return response({error:{message:'Ambiguous failure'}},503);}
      return response({updates:{updatedRows:rows.length}});
    }
    if(url.includes('/values/'))return response({values:window.__cloudMock.rows});
    return response({error:{message:'Unhandled mock '+url}},400);
  };
}'''

def make_page(browser,cloud_rows=None,local=None):
  ctx=browser.new_context(accept_downloads=True)
  p=ctx.new_page()
  p.add_init_script("window.confirm=()=>{throw Error('native dialog blocked')};window.alert=()=>{throw Error('native dialog blocked')};window.prompt=()=>{throw Error('native dialog blocked')};")
  p.evaluate(POLY)
  if local:p.evaluate('(obj)=>{for(const [k,v] of Object.entries(obj))localStorage.setItem(k,v)}',local)
  p.evaluate(FAKE,{'rows':cloud_rows or []})
  p.set_content(HTML,wait_until='domcontentloaded')
  p.locator('button[data-view="cloud"]').click()
  return ctx,p

def connect(p,client=CLIENT,sheet=''):
  p.locator('#cloud-client').fill(client)
  if sheet:p.locator('#cloud-sheet').fill(sheet)
  p.locator('[data-cloud="connect"]').click()
  p.wait_for_function("document.querySelector('#cloud-status')?.textContent.includes('同期成功') || document.querySelector('#cloud-status')?.textContent.includes('失敗')")
  return p.locator('#cloud-status').inner_text()

def gradeA1(p):
  p.locator('button[data-section="A1"]').first.click()
  qs=[q for q in SEED['questions'] if q['section']=='A1']
  for q in qs:p.locator(f'article[data-question-id="{q["question_id"]}"] input[value="{q["answer"]}"]').check()
  p.locator('#submit-set').click();assert p.locator('#modal').is_visible()
  p.locator('[data-modal="yes"]').click()
  assert p.evaluate('window.__IPA_APP_STATUS__.records')==10

results=[]
def ok(name,condition):
  assert condition,name
  results.append(name)

with sync_playwright() as pw:
  chromium=os.environ.get('IPA_CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
  browser=pw.chromium.launch(headless=True,executable_path=chromium,args=['--no-sandbox','--disable-dev-shm-usage'])
  errors=[]
  ctx,p=make_page(browser)
  p.on('pageerror',lambda err:errors.append(str(err)))
  msg=connect(p,client='invalid')
  ok('クライアントID不正は拒否し成績保持','失敗' in msg and p.evaluate('window.__IPA_APP_STATUS__.records')==0)
  msg=connect(p)
  ok('Google API模擬で本人用成績台帳を初期作成','同期成功' in msg and 'sheetMock' in p.locator('#cloud-sheet').input_value())
  ok('OAuthトークンがlocalStorageに保存されない','test-access-token' not in str(p.evaluate('localStorage._dump()')))
  gradeA1(p)
  p.wait_for_function('window.__cloudMock.rows.length===11')
  ok('10問と採点セットが単一追記リクエストで保存',p.evaluate("window.__cloudMock.requests.filter(x=>x.url.includes(':append')).length") == 1)
  ok('採点後クラウド記録10件と採点1件',p.evaluate("window.__cloudMock.rows.filter(x=>x[0]==='RECORD').length") == 10 and p.evaluate("window.__cloudMock.rows.filter(x=>x[0]==='ATTEMPT').length") == 1)
  p.locator('button[data-view="cloud"]').click()
  p.locator('[data-cloud="sync"]').click()
  p.wait_for_function("document.querySelector('#cloud-status').textContent.includes('同期成功')")
  ok('再同期で二重追記しない',p.evaluate("window.__cloudMock.requests.filter(x=>x.url.includes(':append')).length") == 1)
  rows=p.evaluate('window.__cloudMock.rows')
  cloud_local=p.evaluate('localStorage._dump()')
  ctx2,p2=make_page(browser,rows,{'ipa-system-cloud-settings-v1':cloud_local['ipa-system-cloud-settings-v1']})
  p2.on('pageerror',lambda err:errors.append(str(err)))
  msg=connect(p2,client=CLIENT,sheet=SHEET)
  ok('別ブラウザで10問と採点セットを復元','同期成功' in msg and p2.evaluate('window.__IPA_APP_STATUS__.records')==10 and p2.evaluate('window.__IPA_APP_STATUS__.attempts')==1)
  ok('別ブラウザの初回接続は不要な追記なし',p2.evaluate("window.__cloudMock.requests.filter(x=>x.url.includes(':append')).length") == 0)
  # Inject a corrupted answer with same ID, ensure reject without modifying local state.
  changed=p2.evaluate('window.__cloudMock.rows'); rec=next(row for row in changed if row[0]=='RECORD')
  bad=json.loads(rec[19]);bad['answer']='?' if bad['answer']!='?' else 'B'
  rec[19]=json.dumps(bad,ensure_ascii=False,separators=(',',':'))
  p2.evaluate('(r)=>window.__cloudMock.rows=r',changed)
  p2.locator('[data-cloud="sync"]').click()
  p2.wait_for_function("document.querySelector('#cloud-status').textContent.includes('同期失敗')")
  ok('同じ記録IDの内容矛盾を拒否しローカル記録保持',p2.evaluate('window.__IPA_APP_STATUS__.records')==10 and p2.evaluate("window.__cloudMock.requests.filter(x=>x.url.includes(':append')).length")==0)
  # A transport error after append is retry-safe, despite ambiguous response.
  ctx3,p3=make_page(browser)
  connect(p3)
  p3.evaluate('window.__cloudMock.failAfterAppend=true')
  gradeA1(p3)
  p3.wait_for_function("window.__cloudMock.rows.length===11")
  p3.locator('button[data-view="cloud"]').click()
  p3.locator('[data-cloud="sync"]').click()
  p3.wait_for_function("document.querySelector('#cloud-status').textContent.includes('同期成功')")
  ok('API書込み後通信失敗を再試行しても重複記録なし',p3.evaluate('window.__cloudMock.rows.length')==11)
  ok('Google接続不可時も従来採点機能が動作',p3.evaluate('window.__IPA_APP_STATUS__.records')==10)
  ok('Cloud UI例外ゼロ',len(errors)==0)
  ctx.close();ctx2.close();ctx3.close();browser.close()
print(f'PASS: {len(results)}/{len(results)} cloud sync tests (mock Google API)')
for name in results:print('PASS',name)
