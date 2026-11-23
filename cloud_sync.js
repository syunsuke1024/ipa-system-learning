'use strict';
/* IPA learning app cloud sync: append-only Google Sheets journal.
   No OAuth secret or bearer token is embedded in HTML or persisted. */
window.IPACloudSync = (() => {
  const SETTINGS_KEY = 'ipa-system-cloud-settings-v1';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const SCHEMA = 'ipa-study-cloud-log-v1';
  const TAB = 'LearningLog';
  const HEADERS = ['kind','id','attempt_id','bank_version','question_id','question_version','section','major',
    'minor','difficulty','answer','correct','unknown','mode','is_first_seen','answered_at',
    'submitted_at','answer_date','elapsed_seconds','payload_json'];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const validId = value => /^[a-zA-Z0-9_-]{15,180}$/.test(String(value||''));
  const validClient = value => /^[0-9]+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(String(value||''));
  function create(callbacks) {
    let settings = {clientId:'', sheetId:''};
    try { const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}');
      if (typeof saved.clientId === 'string') settings.clientId=saved.clientId;
      if (typeof saved.sheetId === 'string') settings.sheetId=saved.sheetId;
    } catch (_) { /* cloud options are independent from protected learning history */ }
    let token=null, expiresAt=0, busy=false, status='未接続（ブラウザ内の成績はそのまま保持）';
    let lastSync='', lastCounts=null;
    const update = (message, failure=false) => { status=message; callbacks.render(); if (failure) callbacks.notify(message,true); };
    function save() {
      localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));
    }
    function statusBrief() { return token && Date.now()<expiresAt ? 'Google接続済み' : '未認証'; }
    function render() {
      return `<div class="panel"><div class="head-row"><div><p class="eyebrow">PRIVATE CLOUD / GOOGLE SHEETS</p><h2>成績のクラウド同期</h2></div><span class="tag">${esc(statusBrief())}</span></div>
      <p>ブラウザ内の成績は保持したまま、本人の非公開Google Sheetsへ<strong>追記方式</strong>で同期します。認証トークンはメモリ内のみ保持し、HTMLやGitHubには保存しません。</p>
      <div class="filter-bar cloud-fields"><label>Google OAuth クライアントID（Web用）<input id="cloud-client" class="cloud-long-input" type="text" spellcheck="false" autocomplete="off" placeholder="123...apps.googleusercontent.com" value="${esc(settings.clientId)}"></label>
      <label>既存の成績シートID（初回は空欄）<input id="cloud-sheet" class="cloud-long-input" type="text" spellcheck="false" autocomplete="off" placeholder="別端末の場合は既存シートIDを入力" value="${esc(settings.sheetId)}"></label></div>
      <div class="actions"><button class="btn primary" data-cloud="connect" ${busy?'disabled':''}>Googleで接続して同期</button><button class="btn" data-cloud="sync" ${busy||!token?'disabled':''}>今すぐ同期</button></div>
      <p id="cloud-status" role="status" aria-live="polite">${esc(status)}</p>
      ${settings.sheetId && validId(settings.sheetId) ? `<p>成績台帳：<a href="https://docs.google.com/spreadsheets/d/${encodeURIComponent(settings.sheetId)}/edit" target="_blank" rel="noopener noreferrer">Google Sheetsで開く</a></p>`:''}
      ${lastCounts ? `<p class="micro">直近結果：クラウド${lastCounts.remote}件、今回の追加${lastCounts.uploaded}件、端末へ復元${lastCounts.downloaded}件 ／ ${esc(lastSync)}</p>` : ''}
      <details><summary>初回セットアップ・安全上の注意</summary><p>Google CloudでSheets APIを有効化し、OAuth同意画面を設定後、Webアプリ用クライアントIDを作成します。承認済みJavaScript生成元には <code>https://syunsuke1024.github.io</code> を登録してください（URLのパスは不要）。外部・テスト公開の場合は自分のGoogleアカウントをテストユーザーへ登録します。</p>
      <p>API権限は <code>drive.file</code> のみ要求します。新規シートはこのアプリが作成します。別端末では同じOAuthクライアントIDとシートIDを入力して接続します。権限はGoogleアカウント側から取り消せます。</p>
      <p>Googleへの接続時はGoogleの承認ポップアップが開きます。通常の採点確認にはブラウザ標準ダイアログを使用しません。認証の期限が切れたらもう一度「Googleで接続して同期」を押してください。</p>
      <p>初回同期前に成績JSONをエクスポートして保管してください。台帳は記録ID単位の追記型です。通信断や多端末からの同時書込みでは、重複した行が記録される可能性がありますが、読み込み時に重複を排除し、内容不一致はエラーにします。既存行を削除・更新しません。</p>
      <p>ChatGPTがこの台帳を参照するには、同じGoogleアカウントのDrive/Sheets接続と対象シートへのアクセスが必要です。Google認証設定と公開サイトでの実接続は、別途本人による確認が必要です。</p></details>
      <p class="micro">現在の端末：${callbacks.getState().records.length}件の問題別記録。同期できないときも採点・ローカル保存・JSON出力は利用可能です。</p></div>`;
    }
    function readInputs() {
      const c=document.getElementById('cloud-client'); const s=document.getElementById('cloud-sheet');
      const clientId=(c?.value??settings.clientId).trim(),sheetId=(s?.value??settings.sheetId).trim();
      if (!validClient(clientId)) throw Error('Google OAuthクライアントIDの形式が正しくありません');
      if (sheetId && !validId(sheetId)) throw Error('成績シートIDの形式が正しくありません');
      // A different sheet on the same browser must not inherit the previous account's token.
      if (clientId!==settings.clientId || sheetId!==settings.sheetId) { token=null; expiresAt=0; }
      settings={clientId,sheetId}; save();
    }
    async function authorize() {
      if (!window.google?.accounts?.oauth2?.initTokenClient)
        throw Error('Google認証ライブラリを読み込めません。ネット接続とブラウザの拡張機能を確認してください');
      const value=await new Promise((resolve,reject)=>{
        const client=window.google.accounts.oauth2.initTokenClient({
          client_id:settings.clientId,scope:SCOPE,
          callback:response => response?.access_token ? resolve(response) : reject(Error(response?.error||'Google認証が中断されました')),
          error_callback:err => reject(Error(err?.message||err?.type||'Google認証ポップアップが開けません'))
        });
        client.requestAccessToken({prompt:'consent'});
      });
      token=value.access_token;
      expiresAt=Date.now()+Math.max(30,Number(value.expires_in||3600)-90)*1000;
    }
    async function api(url,options={}) {
      if (!token || Date.now() >= expiresAt) throw Error('Google認証の期限が切れました。「Googleで接続して同期」を押してください');
      let response;
      try { response=await fetch(url,{...options,headers:{Authorization:`Bearer ${token}`, ...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})},cache:'no-store'}); }
      catch (e) { throw Error('Google APIへの通信に失敗しました。接続を確認してください'); }
      let data;
      try { data=await response.json(); } catch (_) { data={}; }
      if (!response.ok) throw Error(`Google API HTTP ${response.status}: ${data?.error?.message || '認証・アクセス権・APIの有効化を確認してください'}`);
      return data;
    }
    const sheetUrl = (suffix) => `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(settings.sheetId)}${suffix}`;
    async function makeSheet() {
      const data=await api('https://sheets.googleapis.com/v4/spreadsheets',{
        method:'POST',body:JSON.stringify({properties:{title:'IPA_SYSTEM_PRIVATE_LEARNING_RECORDS_v1'},
          sheets:[{properties:{title:TAB,gridProperties:{frozenRowCount:1}}},{properties:{title:'Config'}}]})
      });
      if (!validId(data.spreadsheetId)) throw Error('Google Sheetsから有効なIDが返りませんでした');
      settings.sheetId=data.spreadsheetId; save();
      // Write metadata first and headers second. A partially initialized sheet is never used for recording.
      await api(sheetUrl('/values:batchUpdate'),{method:'POST',body:JSON.stringify({valueInputOption:'RAW',data:[
        {range:'Config!A1:B2',values:[['schema_version',SCHEMA],['data_policy','append-only; never publish']]},
        {range:`${TAB}!A1:T1`,values:[HEADERS]}
      ]})});
    }
    async function checkSheet() {
      if (!validId(settings.sheetId)) throw Error('同期先の成績シートIDがありません');
      const data=await api(sheetUrl('/values:batchGet?ranges=Config%21A1%3AB1&ranges=LearningLog%21A1%3AT1'));
      const ranges=data.valueRanges||[];
      const marker=ranges[0]?.values?.[0]||[], header=ranges[1]?.values?.[0]||[];
      if (marker[0]!=='schema_version'||marker[1]!==SCHEMA||JSON.stringify(header)!==JSON.stringify(HEADERS))
        throw Error('指定したシートがIPA成績台帳v1ではないか、初期化が不完全です。誤書込みを防ぐため停止しました');
    }
    const rowForRecord = r => ['RECORD',r.record_id,r.attempt_id,r.bank_version,r.question_id,r.question_version,r.section,
      r.major,r.minor,r.difficulty,r.answer,String(r.correct),String(r.unknown),r.mode,String(r.is_first_seen),
      r.answered_at,r.submitted_at,r.answer_date,String(r.elapsed_seconds??''),JSON.stringify(r)];
    const rowForAttempt = a => ['ATTEMPT',a.attempt_id,a.attempt_id,a.bank_version,'','',a.section,'','','','','','','',
      '', '',a.submitted_at,a.answer_date,'',JSON.stringify(a)];
    async function readLog() {
      const res=await api(sheetUrl(`/values/${encodeURIComponent(TAB+'!A2:T')}?valueRenderOption=UNFORMATTED_VALUE`));
      const records=[],attempts=[],keys=new Map();
      for (const row of res.values||[]) {
        if (row.length===0) continue;
        const kind=row[0],ident=row[1];
        if (!['RECORD','ATTEMPT'].includes(kind)||!ident||typeof row[19]!=='string')
          throw Error('クラウドの成績行に欠損があります。書込みせず停止します');
        let value;try{value=JSON.parse(row[19]);}catch(_){throw Error('クラウドに不正なJSON行があります');}
        if ((kind==='RECORD'&&value.record_id!==ident)||(kind==='ATTEMPT'&&value.attempt_id!==ident))
          throw Error('クラウド行の識別子が一致しません');
        if (callbacks.isBankRetained?.(value.bank_version) === false) continue;
        const key=`${kind}:${ident}`,serialized=JSON.stringify(value);
        if (keys.has(key)&&keys.get(key)!==serialized) throw Error('同じ記録IDで内容が異なるクラウド行があります');
        if (keys.has(key)) continue;
        keys.set(key,serialized);
        (kind==='RECORD'?records:attempts).push(value);
      }
      return {schema_version:'ipa-unified-study-1',records,attempts};
    }
    function assertNoConflict(remote) {
      // Dry-run merge in isolated app state (does not mutate originals on failure).
      callbacks.validateMerge(remote);
    }
    async function sync() {
      if (busy) return;
      busy=true; update('クラウド台帳の確認・双方の履歴を比較中');
      try {
        await checkSheet();
        const remote=await readLog();
        assertNoConflict(remote);
        const local=callbacks.getState();
        const rid=new Set(remote.records.map(r=>r.record_id)),aid=new Set(remote.attempts.map(a=>a.attempt_id));
        const missingRecords=local.records.filter(r=>callbacks.isBankRetained?.(r.bank_version)!==false&&!rid.has(r.record_id));
        const missingAttempts=local.attempts.filter(a=>callbacks.isBankRetained?.(a.bank_version)!==false&&!aid.has(a.attempt_id));
        const rows=[...missingRecords.map(rowForRecord),...missingAttempts.map(rowForAttempt)];
        if (rows.length) {
          await api(sheetUrl(`/values/${encodeURIComponent(TAB+'!A:T')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`),{
            method:'POST',body:JSON.stringify({majorDimension:'ROWS',values:rows})
          });
        }
        // Always read back before reporting success. Recover safely from ambiguous writes by retrying.
        const after=await readLog();
        assertNoConflict(after);
        const afterIds=new Set(after.records.map(r=>r.record_id)),afterAtt=new Set(after.attempts.map(a=>a.attempt_id));
        if (local.records.some(r=>callbacks.isBankRetained?.(r.bank_version)!==false&&!afterIds.has(r.record_id))||local.attempts.some(a=>callbacks.isBankRetained?.(a.bank_version)!==false&&!afterAtt.has(a.attempt_id)))
          throw Error('クラウド書込みの確認ができません。ローカル成績は保持しました。再度同期してください');
        const result=callbacks.mergeRemote(after);
        lastSync=new Date().toLocaleString('ja-JP');lastCounts={remote:after.records.length,uploaded:missingRecords.length,downloaded:result.added};
        update(`同期成功：クラウド${after.records.length}件／送信${missingRecords.length}件／端末へ追加${result.added}件`);
      } catch (err) { update(`同期失敗：${err.message||err}（既存の成績は保持しています）`,true); }
      finally { busy=false;callbacks.render(); }
    }
    async function onAction(action) {
      if (busy) return;
      try {
        if (action==='connect') {
          readInputs();
          // requestAccessToken must be called from the user click path, not automatically on page load.
          await authorize();
          update('Google認証成功。成績台帳を確認しています');
          if (!settings.sheetId) {
            busy=true;update('本人のGoogle Driveに非公開の成績台帳を新規作成中');
            try { await makeSheet(); } finally {busy=false;}
          }
          await sync();
        } else if (action==='sync') await sync();
      } catch (e) { update(`クラウド接続失敗：${e.message||e}（ローカル成績は保持）`,true); }
    }
    function autoSync() { if (token&&Date.now()<expiresAt&&!busy&&settings.sheetId) void sync(); }
    return {render,onAction,autoSync,statusBrief};
  }
  return {create,HEADERS,SCHEMA};
})();
