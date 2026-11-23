'use strict';
(() => {
  const STORAGE_KEY = 'ipa-system-unified-study-v1';
  const LEGACY_STORAGE_KEY = 'ipa-systems-quality-test-15q-v1-records';
  const SCHEMA = 'ipa-unified-study-1';
  const PARTS = ['A1', 'A2', 'B'];
  const PART_NAMES = { A1: '科目A-1｜共通知識', A2: '科目A-2｜専門知識', B: '科目B｜応用技能' };
  const LETTERS = 'ABCD';
  const SEED = JSON.parse(document.getElementById('seed-bank').textContent);
  const LEGACY = JSON.parse(document.getElementById('legacy-meta').textContent);
  const fresh = () => ({
    schema_version: SCHEMA, banks: {}, records: [], attempts: [], drafts: {}, mockSessions: {},
    schedule: { exam: '', applicationFrom: '', applicationTo: '' },
    selectedBank: SEED.bank_version, selectedSection: 'A1', studyPages: {},
    view: 'study', dashboardMode: 'first', dashboardExamMode: 'learning', dashboardBank: 'all',
    dashboardSection: 'all', reportMajor: 'all', catalogStatus: '起動中'
  });
  let state = fresh();
  let storageMessage = '保存状況を確認中';
  let pendingAction = null;
  let confirmationBusy = false;
  let noticeTimer = null;
  let storageLocked = false;
  let loadedSources = {};
  const cloud = window.IPACloudSync.create({
    getState: () => state,
    render: () => render(),
    notify: (message, isError) => notify(message, isError),
    validateMerge: incoming => {
      const original=state;
      state=JSON.parse(JSON.stringify(original));
      try { mergeRecords(incoming); } finally { state=original; }
    },
    mergeRemote: incoming => {
      const result=mergeRecords(incoming);
      if (!persist()) throw Error("ローカル保存に失敗しました。JSONエクスポートしてください");
      render();
      return result;
    }
  });

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
  const uniqueId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() :
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const localDate = (value = new Date()) => {
    const d = value instanceof Date ? value : new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const percentage = (numerator, denominator) => denominator ? `${(100 * numerator / denominator).toFixed(1)}%` : '—';
  const jpDate = value => {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ja-JP', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });
  };
  const isDate = str => {
    if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
    const date = new Date(`${str}T00:00:00`);
    return !Number.isNaN(date.getTime()) && localDate(date) === str;
  };
  const dateMillis = str => new Date(`${str}T00:00:00`).valueOf();
  const bankLabel = bank => bank.display_name || bank.title || bank.bank_version;
  const entryKey = (bankVersion, section) => `${bankVersion}::${section}`;
  const recordQuestionKey = r => `${r.bank_version}::${r.question_id}::${r.question_version}`;
  const bankList = () => Object.values(state.banks);
  const currentBank = () => state.banks[state.selectedBank] || bankList()[0];
  const questionsFor = (bank, section) => bank ? bank.questions.filter(q => q.section === section) : [];
  const questionAt = (version, id, qVersion = null) => {
    const bank = state.banks[version];
    return bank?.questions.find(q => q.question_id === id && (qVersion === null || q.question_version === qVersion));
  };

  function notify(message, failure = false) {
    const el = $('notice');
    el.textContent = String(message);
    el.className = `notice ${failure ? 'notice-error' : ''}`;
    el.hidden = false;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { el.hidden = true; }, 8500);
  }
  function reportError(e) { notify(`処理に失敗しました：${String(e?.message || e)}`, true); }
  window.addEventListener('error', event => {
    if (event.message) notify(`画面の処理でエラーが発生しました：${event.message}`, true);
  });
  window.addEventListener('unhandledrejection', event => reportError(event.reason));
  function ask(message, action) {
    pendingAction = action;
    $('modal-message').textContent = message;
    $('modal').hidden = false;
    $('modal-yes').focus();
  }
  function completeAsk(approve) {
    const action = pendingAction;
    pendingAction = null;
    $('modal').hidden = true;
    if (approve && action && !confirmationBusy) {
      confirmationBusy = true;
      try { action(); } catch (error) { reportError(error); }
      finally { confirmationBusy = false; }
    }
  }
  function persist() {
    if (storageLocked) {
      storageMessage = '既存データの読込に失敗：安全のため自動上書きを停止中';
      return false;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageMessage = 'ブラウザ内に保存済み';
      return true;
    } catch (error) {
      storageMessage = 'ブラウザ保存不可：JSONバックアップを出力してください';
      notify(storageMessage, true);
      return false;
    }
  }

  function normalizedBank(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.bank_version !== 'string' ||
        raw.bank_version.length < 3 || raw.bank_version.length > 170 || !Array.isArray(raw.questions) || !raw.questions.length)
      throw new Error('問題集JSONには bank_version と questions（1問以上）が必要です');
    if (raw.questions.length > 500) throw new Error('1問題集の上限は500問です');
    if (raw.questions.length !== new Set(raw.questions.map(q => q.question_id || q.id)).size)
      throw new Error('同じ問題集内に重複する問題IDがあります');
    const questions = raw.questions.map((q, index) => {
      if (!q || !PARTS.includes(q.section) || typeof q.question_id !== 'string' ||
          !q.question_id || !q.question_version || !q.major || !q.minor || !q.difficulty ||
          !q.stem || !Array.isArray(q.options) || q.options.length !== 4 ||
          q.options.some(t => typeof t !== 'string' || !t.trim()) ||
          !LETTERS.includes(q.answer) || typeof q.why !== 'string' || !q.why.trim() ||
          !Array.isArray(q.optionNotes) || q.optionNotes.length !== 4 ||
          q.optionNotes.some(t => typeof t !== 'string' || !t.trim()) ||
          typeof q.depth !== 'string' || !q.depth.trim() ||
          typeof q.application !== 'string' || !q.application.trim())
        throw new Error(`${index + 1}問目：設問・解説・4選択肢・分野などの必須項目が不足しています`);
      return {
        question_id: q.question_id, question_version: String(q.question_version),
        section: q.section, major: String(q.major), minor: String(q.minor),
        difficulty: String(q.difficulty), stem: String(q.stem),
        case: String(q.case || ''), options: q.options.map(String), answer: q.answer,
        why: q.why, optionNotes: q.optionNotes, depth: q.depth,
        application: q.application
      };
    });
    const ids = new Set(questions.map(q => q.question_id));
    if (ids.size !== questions.length) throw new Error('問題IDが重複しています');
    return {
      bank_version: raw.bank_version, display_name: String(raw.display_name || raw.title || raw.bank_version),
      source_notice: String(raw.source_notice || '非公式の予想問題'),
      questions, source: String(raw.source || ''),
      audit_status: String(raw.audit_status || '未検証（構造チェックのみ）')
    };
  }
  function sameBank(a, b) {
    // Source labels differ for inline/published/user imports; question and answer content must not.
    return JSON.stringify(a.questions) === JSON.stringify(b.questions);
  }
  function registerBanks(inputs, source = 'JSON追加') {
    const incoming = inputs.map(normalizedBank);
    const batch = new Map();
    for (const bank of incoming) {
      if (batch.has(bank.bank_version) && !sameBank(batch.get(bank.bank_version), bank))
        throw new Error('同じbank_versionに異なる内容の問題集があります');
      if (state.banks[bank.bank_version] && !sameBank(state.banks[bank.bank_version], bank))
        throw new Error(`問題集 ${bank.bank_version} の内容が登録済みデータと異なります。改訂版は新しいbank_versionにしてください`);
      batch.set(bank.bank_version, bank);
    }
    let added = 0;
    for (const bank of batch.values()) {
      if (!state.banks[bank.bank_version]) {
        bank.source = source;
        state.banks[bank.bank_version] = bank;
        loadedSources[bank.bank_version] = source;
        added++;
      }
    }
    return added;
  }
  function legacyV11Data() {
    const saved = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!saved) return null;
    const obj = JSON.parse(saved);
    if (obj.schema_version !== 'ipa-study-records-1' || !Array.isArray(obj.records)) return null;
    return obj;
  }
  function hydrate() {
    let existing = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.schema_version !== SCHEMA || !Array.isArray(parsed.records) || !Array.isArray(parsed.attempts))
          throw new Error('既存の保存データの形式が異なります');
        existing = parsed;
      }
    } catch (e) { storageLocked = true; notify('既存の保存データの形式が不正です。保護のため上書きを停止しました。元データは削除していません。', true); }
    if (existing) {
      state = { ...fresh(), ...existing, banks: existing.banks || {},
        drafts: existing.drafts || {}, studyPages: existing.studyPages || {}, mockSessions: existing.mockSessions || {},
        schedule: { ...fresh().schedule, ...(existing.schedule || {}) } };
    }
    // Inline source is available even if the catalog fetch fails in a local-file preview.
    try { registerBanks([SEED], '内蔵サンプル（品質監査済み）'); }
    catch (e) { notify(`内蔵問題の読込に失敗：${e.message}`, true); }
    if (!state.banks[state.selectedBank]) state.selectedBank = SEED.bank_version;
    // The old 15-question app uses an independent key. Import it without destroying the source.
    try {
      const previous = legacyV11Data();
      if (previous) {
        const merged = mergeRecords(previous);
        if (merged.added) notify(`旧15問アプリの履歴を ${merged.added} 件自動取込みしました。元データも残しています。`);
      }
    } catch (e) { notify('旧アプリの自動移行に失敗しました。成績JSONをインポートしてください。', true); }
    persist();
  }
  function studyGroups(bank,part){
  const qs=questionsFor(bank,part), size=part==='A1'?10:part==='A2'?8:4;
  if(qs.length<=size)return [qs];
  const groups=[];for(let i=0;i<qs.length;i+=size)groups.push(qs.slice(i,i+size));return groups;
}
  function studyIndex(bank,part){
  const groups=studyGroups(bank,part),n=state.studyPages?.[entryKey(bank.bank_version,part)];
  return Number.isInteger(n)&&n>=0&&n<groups.length?n:0;
}
  function getDraft(bank,part){
  const key=entryKey(bank.bank_version,part);
  if(!state.drafts[key])state.drafts[key]={answers:{},timestamps:{},startedAt:new Date().toISOString()};
  const d=state.drafts[key];if(!d.blockStartedAt)d.blockStartedAt={};
  const i=studyIndex(bank,part);if(!d.blockStartedAt[i])d.blockStartedAt[i]=new Date().toISOString();return d;
}
  function lastAttempt(bank,part,i=studyIndex(bank,part)){
  const groups=studyGroups(bank,part),qs=groups[i],d=getDraft(bank,part);if(!qs)return null;
  if(groups.length===1&&d.retake)return null;
  if(groups.length>1&&d.retakeBlocks?.[i])return null;
  const ids=new Set(qs.map(q=>q.question_id));
  return [...state.attempts].reverse().find(a=>{
    if(a.bank_version!==bank.bank_version||a.section!==part||(a.mode||'learning')!=='learning')return false;
    if(groups.length===1)return true;
    if(a.total!==qs.length)return false;
    if(a.study_block_index===i&&a.study_block_count===groups.length)return true;
    if(Number.isInteger(a.study_block_index))return false;
    const rowIds=state.records.filter(r=>r.attempt_id===a.attempt_id).map(r=>r.question_id);
    return rowIds.length===ids.size&&rowIds.every(id=>ids.has(id));
  })||null;
}
  function selectStudyBlock(i){
  const bank=currentBank(),part=state.selectedSection;if(!bank)return;
  const groups=studyGroups(bank,part);
  if(!Number.isInteger(i)||i<0||i>=groups.length)return notify('セット番号が正しくありません',true);
  for(let n=0;n<i;n++)if(!lastAttempt(bank,part,n))return notify(`第${n+1}セットの採点後に進めます`,true);
  state.studyPages[entryKey(bank.bank_version,part)]=i;
  getDraft(bank,part);persist();render();window.scrollTo(0,0);
}
  function openSet(version, part) {
    if (!state.banks[version] || !PARTS.includes(part) || questionsFor(state.banks[version], part).length === 0)
      throw new Error('問題集・科目を確認できませんでした');
    state.selectedBank = version;
    state.selectedSection = part;
    state.view = 'study';
    getDraft(state.banks[version], part);
    persist(); render(); window.scrollTo(0, 0);
  }
  function switchView(view) {
    if (!['study', 'dashboard', 'history', 'library', 'cloud', 'mock'].includes(view)) return;
    state.view = view; persist(); render(); window.scrollTo(0, 0);
  }
  function selectAnswer(id,value){
  const bank=currentBank(),part=state.selectedSection;if(!bank||lastAttempt(bank,part))return;
  if(!studyGroups(bank,part)[studyIndex(bank,part)].some(q=>q.question_id===id)||!['A','B','C','D','?'].includes(value))return;
  const d=getDraft(bank,part);d.answers[id]=value;d.timestamps[id]=new Date().toISOString();persist();render();
}
  function submitSet(){
  const bank=currentBank(),part=state.selectedSection;if(!bank)return notify('問題集がありません',true);
  const i=studyIndex(bank,part),groups=studyGroups(bank,part),qs=groups[i];
  if(!qs?.length)return notify('採点対象がありません',true);
  const d=getDraft(bank,part),missing=qs.filter(q=>!d.answers[q.question_id]);
  if(missing.length)return notify(`未回答が${missing.length}問あります。「わからない」も選択できます。`,true);
  if(lastAttempt(bank,part,i))return notify('このセットは採点済みです。再演習は専用ボタンを押してください。',true);
  const label=groups.length>1?`第${i+1}セット（${qs.length}問）`:`${qs.length}問`;
  ask(`${bankLabel(bank)}｜${PART_NAMES[part]} の${label}を採点します。回答を確定してよろしいですか？`,()=>gradeSet(bank.bank_version,part,i));
}
  function gradeSet(version,part,i=0){
  const bank=state.banks[version];if(!bank)throw Error('問題集がありません');
  const groups=studyGroups(bank,part),qs=groups[i],d=getDraft(bank,part);
  if(!qs||studyIndex(bank,part)!==i||lastAttempt(bank,part,i)||qs.some(q=>!d.answers[q.question_id]))
    throw Error('採点対象の回答状態が変化しました。もう一度確認してください');
  const now=new Date(),when=now.toISOString(),day=localDate(now),attempt_id=uniqueId();
  const records=qs.map(q=>{
    const answer=d.answers[q.question_id],prior=state.records.some(r=>r.question_id===q.question_id&&r.question_version===q.question_version&&r.bank_version===version);
    return {record_id:uniqueId(),attempt_id,bank_version:version,question_id:q.question_id,question_version:q.question_version,
      section:part,major:q.major,minor:q.minor,difficulty:q.difficulty,answer,correct:answer===q.answer,
      unknown:answer==='?',mode:'learning',is_first_seen:!prior,study_block_index:i,
      answered_at:d.timestamps[q.question_id]||when,submitted_at:when,answer_date:day,
      elapsed_seconds:Math.max(0,Math.round((now-new Date(groups.length>1?(d.blockStartedAt?.[i]||when):(d.startedAt||when)))/1000))};
  });
  const correct=records.filter(r=>r.correct).length,unknown=records.filter(r=>r.unknown).length;
  state.records.push(...records);
  state.attempts.push({attempt_id,bank_version:version,section:part,submitted_at:when,answer_date:day,total:qs.length,
    correct,unknown,mode:'learning',...(groups.length>1?{study_block_index:i,study_block_count:groups.length}:{})});
  if(groups.length===1)delete d.retake;
  else if(d.retakeBlocks)delete d.retakeBlocks[i];
  const saved=persist();render();
  notify(`採点完了：${correct}/${qs.length}問正解・わからない${unknown}問${saved?'／ブラウザ保存済み':'／JSONバックアップが必要'}`,!saved);
  if(saved)cloud.autoSync();
}
  function retrySet(){
  const bank=currentBank(),part=state.selectedSection;if(!bank)return;
  const groups=studyGroups(bank,part),i=studyIndex(bank,part);
  const msg=groups.length>1?`${bankLabel(bank)} の${PART_NAMES[part]} 第${i+1}セットを再演習します。ほかのセットと過去の成績は保持します。`:
    `${bankLabel(bank)} の${PART_NAMES[part]}を再演習します。採点済みの履歴は保持します。`;
  ask(msg,()=>{
    const d=getDraft(bank,part);
    if(groups.length===1){d.answers={};d.timestamps={};d.startedAt=new Date().toISOString();d.retake=true;}
    else {for(const q of groups[i]){delete d.answers[q.question_id];delete d.timestamps[q.question_id];}
      if(!d.retakeBlocks)d.retakeBlocks={};d.retakeBlocks[i]=true;d.blockStartedAt[i]=new Date().toISOString();}
    persist();render();notify('再演習を開始しました。過去の採点履歴は保持しています。');
  });
}
  function chosenRecords() {
    const all = state.records.filter(r => (r.mode || 'learning') === state.dashboardExamMode &&
      (state.dashboardBank === 'all' || r.bank_version === state.dashboardBank) &&
      (state.dashboardSection === 'all' || r.section === state.dashboardSection));
    const ordered = [...all].sort((a, b) => (a.submitted_at || '').localeCompare(b.submitted_at || ''));
    const mode = state.dashboardMode;
    if (mode === 'all') return ordered;
    const chosen = new Map();
    for (const r of ordered) {
      const key = recordQuestionKey(r);
      if (mode === 'first' && !chosen.has(key)) chosen.set(key, r);
      if (mode === 'latest') chosen.set(key, r);
    }
    return [...chosen.values()];
  }
  function groupBy(records, selector) {
    const map = new Map();
    for (const r of records) {
      const name = String(selector(r) || '未分類');
      if (!map.has(name)) map.set(name, { name, n: 0, c: 0, u: 0 });
      const o = map.get(name); o.n++; o.c += Number(!!r.correct); o.u += Number(!!r.unknown);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }
  function groupTable(items) {
    if (!items.length) return '<p class="empty">対象の記録はありません。</p>';
    return `<div class="tablewrap"><table><thead><tr><th>分類</th><th>解答数</th><th>正解</th><th>正答率</th><th>わからない</th></tr></thead><tbody>${items.map(r =>
      `<tr><td>${esc(r.name)}</td><td>${r.n}</td><td>${r.c}</td><td>${percentage(r.c, r.n)}</td><td>${r.u}</td></tr>`
    ).join('')}</tbody></table></div>`;
  }
  function dayGraph(records) {
    const days = groupBy(records.filter(r => isDate(r.answer_date)), r => r.answer_date)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!days.length) return '<div class="empty">採点すると日付別の推移が表示されます。</div>';
    const baseDates = days.map(d => dateMillis(d.name));
    const exam = state.schedule.exam;
    const validExam = isDate(exam) && dateMillis(exam) >= Math.max(...baseDates) ? dateMillis(exam) : null;
    let min = Math.min(...baseDates), max = validExam || Math.max(...baseDates);
    if (min === max) { min -= 86400000; max += 86400000; }
    const w = 880, h = 280, l = 53, r = 33, top = 28, bottom = 57;
    const x = t => l + (t - min) / (max - min) * (w - l - r);
    const y = n => top + (100 - n) / 100 * (h - top - bottom);
    let svg = `<svg role="img" aria-label="日付を横軸、正答率を縦軸とした推移" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
    const start = state.schedule.applicationFrom, end = state.schedule.applicationTo;
    if (isDate(start) && isDate(end) && dateMillis(start) <= dateMillis(end)) {
      const a = Math.max(min, dateMillis(start)), b = Math.min(max, dateMillis(end));
      if (a <= b) {
        svg += `<rect x="${x(a).toFixed(1)}" y="${top}" width="${Math.max(2, x(b) - x(a)).toFixed(1)}" height="${h - top - bottom}" fill="#d5e9ed" opacity="0.72"/>`;
        svg += `<text x="${x(a) + 4}" y="${top + 12}" fill="#426c7a" font-size="11">申込期間</text>`;
      }
    }
    for (const rate of [0, 25, 50, 75, 100]) {
      svg += `<line x1="${l}" x2="${w - r}" y1="${y(rate)}" y2="${y(rate)}" stroke="#dfe9ed"/>`;
      svg += `<text x="${l - 12}" y="${y(rate) + 4}" text-anchor="end" font-size="12" fill="#6b7b89">${rate}%</text>`;
    }
    const points = days.map(d => ({ d, px: x(dateMillis(d.name)), py: y(100 * d.c / d.n) }));
    if (points.length > 1) svg += `<polyline fill="none" stroke="#147d87" stroke-width="3" points="${points.map(o => `${o.px.toFixed(1)},${o.py.toFixed(1)}`).join(' ')}"/>`;
    for (const p of points) {
      svg += `<circle cx="${p.px}" cy="${p.py}" r="5" fill="#0c7c81" stroke="white" stroke-width="2"><title>${p.d.name} 正答率 ${percentage(p.d.c, p.d.n)} (${p.d.c}/${p.d.n})</title></circle>`;
    }
    if (validExam) svg += `<line x1="${x(validExam)}" x2="${x(validExam)}" y1="${top}" y2="${h - bottom}" stroke="#b16d30" stroke-dasharray="5,4"/><text x="${x(validExam) - 6}" y="${top + 9}" text-anchor="end" font-size="11" fill="#9a653a">試験日</text>`;
    for (const t of [min, (min + max) / 2, max]) {
      svg += `<text x="${x(t)}" y="${h - 19}" text-anchor="middle" fill="#6b7b89" font-size="11">${localDate(new Date(t))}</text>`;
    }
    svg += '</svg>';
    return `<div class="graph">${svg}</div><details><summary>日付ごとの数値を表示</summary>${groupTable(days)}</details>`;
  }
  function recentTrend() {
    const matching = state.attempts.filter(a => (a.mode || 'learning') === state.dashboardExamMode && (state.dashboardBank === 'all' || a.bank_version === state.dashboardBank) &&
      (state.dashboardSection === 'all' || a.section === state.dashboardSection))
      .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
    if (!matching.length) return '<p class="empty">セット採点後に過去との比較を表示します。</p>';
    const recent = matching.slice(-5), older = matching.slice(-10, -5);
    const total = xs => xs.reduce((a, t) => a + t.total, 0);
    const correct = xs => xs.reduce((a, t) => a + t.correct, 0);
    return `<p>直近${recent.length}セット：<strong>${percentage(correct(recent), total(recent))}</strong> (${correct(recent)}/${total(recent)}問)${older.length ?
      ` ／ その前の${older.length}セット：<strong>${percentage(correct(older), total(older))}</strong> (${correct(older)}/${total(older)}問)` :
      ' ／ 比較可能な過去セットはまだありません'}</p><p class="micro">問題構成や難易度の違いを調整していない比較です。異なる問題集の得点をそのまま同難易度と見なさないでください。</p>`;
  }
  function metric(title, value, note = '') {
    return `<div class="metric"><strong>${esc(value)}</strong><span>${esc(title)}</span>${note ? `<small>${esc(note)}</small>` : ''}</div>`;
  }

  // Two timed phases: A-1 60 questions / 90 min; A-2 + B 35 questions / 120 min.
  // Answer keys and explanations are never rendered before final submission.
  function isFullMock(bank) {
    return !!bank && bank.questions.length === 95 &&
      questionsFor(bank, 'A1').length === 60 && questionsFor(bank, 'A2').length === 23 &&
      questionsFor(bank, 'B').length === 12;
  }
  const phaseLimit = phase => phase === 'A1' ? 90 * 60 : 120 * 60;
  const activeMock = () => Object.values(state.mockSessions || {}).find(m => m.phase !== 'done') || null;
  const mockForBank = version => state.mockSessions?.[version];
  const phaseQuestions = (bank, phase) => phase === 'A1' ? questionsFor(bank, 'A1') :
    [...questionsFor(bank, 'A2'), ...questionsFor(bank, 'B')];
  const remainingSeconds = session => Math.max(0, phaseLimit(session.phase) -
    Math.floor((Date.now() - Date.parse(session.phaseStartedAt)) / 1000));
  const clockLabel = sec => `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  function startMock(version) {
    const bank = state.banks[version];
    if (!isFullMock(bank)) return notify('本番模試はA-1:60問／A-2:23問／B:12問の問題集だけで利用できます', true);
    const running = activeMock();
    if (running && running.bank_version !== version) return notify('別の95問模試が進行中です。途中の結果を保護するため先に完了してください。', true);
    let session = mockForBank(version);
    if (!session || session.phase === 'done') {
      if (session?.phase === 'done') return showMockReview(version);
      session = {run_id: uniqueId(), bank_version:version, phase:'A1',
        startedAt:new Date().toISOString(), phaseStartedAt:new Date().toISOString(),
        answers:{},timestamps:{},phaseDurations:{},phaseCompleted:{}};
      state.mockSessions[version] = session;
    }
    state.selectedBank = version;
    state.view = 'mock';
    if (!persist()) return;
    render(); window.scrollTo(0,0);
  }
  function selectMockAnswer(id,value) {
    const session=activeMock(),bank=session&&state.banks[session.bank_version];
    if (!session||!bank||!['A','B','C','D','?'].includes(value)) return;
    if (remainingSeconds(session)<=0) return closeMockPhase(true);
    if (!phaseQuestions(bank,session.phase).some(q=>q.question_id===id)) return;
    session.answers[id]=value;session.timestamps[id]=new Date().toISOString();
    persist();
    // Radio labels remain intact: DOM re-render only on explicit navigation.
    const answered=phaseQuestions(bank,session.phase).filter(q=>session.answers[q.question_id]).length;
    const progress=$('mock-progress');if(progress) progress.textContent=`${answered}/${phaseQuestions(bank,session.phase).length}問回答済み`;
    const bar=$('mock-progress-bar');if(bar) bar.style.width=`${100*answered/phaseQuestions(bank,session.phase).length}%`;
  }
  function submitMockPhase() {
    const session=activeMock();
    if (!session||session.phase!=='A1') return;
    if (remainingSeconds(session)<=0) return closeMockPhase(true);
    const qs=phaseQuestions(state.banks[session.bank_version],'A1');
    const missing=qs.filter(q=>!session.answers[q.question_id]);
    ask(`A-1の60問を確定してA-2・Bへ進みます。未回答${missing.length}問は「わからない」として0点で記録されます。A-1には戻れません。`,()=>closeMockPhase(false));
  }
  function closeMockPhase(expired) {
    const session=activeMock();if(!session||session.phase!=='A1') return;
    const bank=state.banks[session.bank_version];
    for(const q of phaseQuestions(bank,'A1')) {
      if(!session.answers[q.question_id]) {session.answers[q.question_id]='?';session.timestamps[q.question_id]=new Date().toISOString();}
    }
    session.phaseDurations.A1=Math.min(phaseLimit('A1'),Math.max(0,Math.floor((Date.now()-Date.parse(session.phaseStartedAt))/1000)));
    session.phaseCompleted.A1=new Date().toISOString();
    session.phase='A2B';session.phaseStartedAt=new Date().toISOString();
    if(!persist()) return;
    render();window.scrollTo(0,0);
    notify(`A-1の回答を確定しました。A-2・Bの120分を開始します。${expired?'制限時間終了により自動移行しました。':''}`);
  }
  function submitMockFinal() {
    const session=activeMock();if(!session||session.phase!=='A2B') return;
    if(remainingSeconds(session)<=0) return closeMockFinal(true);
    const bank=state.banks[session.bank_version], qs=phaseQuestions(bank,'A2B');
    const missing=qs.filter(q=>!session.answers[q.question_id]);
    ask(`本番模試95問を最終提出します。A-2・Bの未回答${missing.length}問は「わからない」として0点です。最終提出後に初めて正解・全選択肢の解説を表示します。`,()=>closeMockFinal(false));
  }
  function closeMockFinal(expired) {
    const session=activeMock();if(!session||session.phase!=='A2B') return;
    const bank=state.banks[session.bank_version];
    for(const q of phaseQuestions(bank,'A2B')) {
      if(!session.answers[q.question_id]) {session.answers[q.question_id]='?';session.timestamps[q.question_id]=new Date().toISOString();}
    }
    session.phaseDurations.A2B=Math.min(phaseLimit('A2B'),Math.max(0,Math.floor((Date.now()-Date.parse(session.phaseStartedAt))/1000)));
    const now=new Date(),when=now.toISOString(),day=localDate(now);
    // One session is committed as 95 question records and three section attempts.
    const records=[],attempts=[];
    for(const part of PARTS) {
      const questions=questionsFor(bank,part),attempt_id=uniqueId();
      const subset=questions.map(q=>{
        const answer=session.answers[q.question_id],prior=state.records.some(r=>r.bank_version===bank.bank_version && r.question_id===q.question_id && r.question_version===q.question_version);
        return {record_id:uniqueId(),attempt_id,bank_version:bank.bank_version,
          question_id:q.question_id,question_version:q.question_version,section:part,
          major:q.major,minor:q.minor,difficulty:q.difficulty,answer,
          correct:answer===q.answer,unknown:answer==='?',mode:'mock',
          mock_run_id:session.run_id,is_first_seen:!prior,
          answered_at:session.timestamps[q.question_id]||when,submitted_at:when,answer_date:day,
          elapsed_seconds:session.phaseDurations[part==='A1'?'A1':'A2B']};
      });
      records.push(...subset);
      attempts.push({attempt_id,bank_version:bank.bank_version,section:part,submitted_at:when,
        answer_date:day,total:questions.length,correct:subset.filter(r=>r.correct).length,
        unknown:subset.filter(r=>r.unknown).length,mode:'mock',mock_run_id:session.run_id});
    }
    if(records.length!==95||attempts.length!==3) throw Error('採点件数が一致しません。保存しません');
    // Rollback local state if storage cannot persist; no phantom success.
    const before=JSON.parse(JSON.stringify(session));
    state.records.push(...records);state.attempts.push(...attempts);
    session.phase='done';session.submittedAt=when;session.phaseCompleted.A2B=when;
    if(!persist()) {
      state.records.splice(-95);state.attempts.splice(-3);
      state.mockSessions[bank.bank_version]=before;
      return notify('本番模試の保存に失敗しました。再度提出するか、ブラウザ保存を確認してください',true);
    }
    render();window.scrollTo(0,0);
    notify(`本番模試95問の採点完了。${expired?'残り時間が終了しました。':'最終提出が確定しました。'}成績を保存し同期します。`);
    cloud.autoSync();
  }
  function showMockReview(version) {
    const session=mockForBank(version);
    if(!session||session.phase!=='done') return;
    state.selectedBank=version;state.view='mock';persist();render();window.scrollTo(0,0);
  }
  function retakeMock() {
    const bank=currentBank();if(!isFullMock(bank)) return;
    ask('新しい本番95問模試を開始します。前回の95問の成績は残しますが、同一問題のため再演習として扱われます。',()=>{
      delete state.mockSessions[bank.bank_version];startMock(bank.bank_version);
    });
  }
  function renderMock() {
    const running=activeMock();
    const session=running||mockForBank(state.selectedBank);
    const bank=session?state.banks[session.bank_version]:(isFullMock(currentBank())?currentBank():bankList().find(isFullMock));
    if(!bank||!isFullMock(bank)) return `<div class="panel"><h2>本番95問模試</h2><p>95問（A-1 60問、A-2 23問、B 12問）の問題集が登録されると模試を開始できます。</p><button class="btn" data-view="library">問題集ライブラリを開く</button></div>`;
    if(!session) return `<div class="panel"><h2>本番95問模試</h2><p>A-1 60問・90分とA-2＋B 35問・120分を続けて解答します。最終提出まで正解を表示しません。</p><button class="btn primary" data-mock-start="${esc(bank.bank_version)}">95問模試を開始する</button></div>`;
    if(session.phase==='done') {
      const rows=state.records.filter(r=>r.mock_run_id===session.run_id);
      const c=rows.filter(r=>r.correct).length;
      const parts=PARTS.map(p=>{const subset=rows.filter(r=>r.section===p);return metric(PART_NAMES[p],`${subset.filter(r=>r.correct).length}/${subset.length}`)}).join('');
      const review=bank.questions.map((q,i)=>renderQuestion(q,i,session.answers[q.question_id]||'?',true)).join('');
      return `<div class="panel"><p class="eyebrow">FULL MOCK RESULT · ${esc(bankLabel(bank))}</p><h2>本番95問模試の採点結果</h2><div class="metrics">${metric('合計',`${c}/95`)}${metric('正答率',percentage(c,95))}${metric('不明',String(rows.filter(r=>r.unknown).length))}${metric('所要時間',`${Math.round((session.phaseDurations.A1+session.phaseDurations.A2B)/60)}分`)}</div><div class="metrics">${parts}</div><p>最終提出後のため正解・個別解説を表示します。問題別成績は保存済みです。</p>${review}<div class="sticky-actions"><button class="btn" data-mock-retake="1">95問を再演習</button><button class="btn primary" data-view="dashboard">成績ダッシュボード</button></div></div>`;
    }
    const phase=session.phase,qs=phaseQuestions(bank,phase),answered=qs.filter(q=>session.answers[q.question_id]).length;
    const list=qs.map((q,i)=>{const label=phase==='A2B'&&q.section==='B'?'科目B':phase==='A2B'?'科目A-2':'科目A-1';
      return `<article class="question" data-question-id="${esc(q.question_id)}"><div class="question-meta"><span class="question-num">${label}・問${i+1} ／ ${esc(q.question_id)}</span><span class="micro">${esc(q.major)} › ${esc(q.minor)} · ${esc(q.difficulty)}</span></div>${q.case?`<div class="case">${esc(q.case)}</div>`:''}<div class="stem">${esc(q.stem)}</div><div class="choices">${q.options.map((option,j)=>`<label class="choice"><input type="radio" data-mock-answer="${esc(q.question_id)}" name="mock-${esc(q.question_id)}" value="${LETTERS[j]}" ${session.answers[q.question_id]===LETTERS[j]?'checked':''}><b>${LETTERS[j]}</b><span>${esc(option)}</span></label>`).join('')}<label class="choice unknown-choice"><input type="radio" data-mock-answer="${esc(q.question_id)}" name="mock-${esc(q.question_id)}" value="?" ${session.answers[q.question_id]==='?'?'checked':''}><b>?</b><span>わからない（0点として計上）</span></label></div></article>`;
    }).join('');
    return `<div class="panel"><p class="eyebrow">TIMED FULL MOCK · ${esc(bankLabel(bank))}</p><h2>${phase==='A1'?'第1段階：科目A-1（60問・90分）':'第2段階：科目A-2（23問）＋B（12問）・120分'}</h2><p><b>制限時間：</b><span id="mock-clock" class="mock-clock">${clockLabel(remainingSeconds(session))}</span> ／ <span id="mock-progress">${answered}/${qs.length}問回答済み</span></p><div class="progress"><span id="mock-progress-bar" style="width:${100*answered/qs.length}%"></span></div><p class="micro">途中の回答はこのブラウザに随時保存されます。ページを閉じても制限時間は進みます。A-1は次に進むと戻れません。未回答は確定時に「わからない」として処理します。正解は最終提出まで表示されません。</p>${list}<div class="sticky-actions"><span id="mock-progress-bottom" class="micro">${phase==='A1'?'A-1終了後に次へ':'最終提出時に全95問を採点'}</span><button class="btn primary" ${phase==='A1'?'data-mock-phase="1"':'data-mock-finalize="1"'}>${phase==='A1'?'A-1を確定してA-2＋Bへ':'本番95問を最終提出・採点'}</button></div></div>`;
  }

  function renderSidebar(){
  const chosen=currentBank(),active=state.view,localRecords=state.records.length;
  return `<div class="side-title">学習メニュー</div><div class="navlist">
    <button class="navbtn ${active==='library'?'active':''}" data-view="library">問題集ライブラリ<small>${bankList().length}種類の問題集を利用可能</small></button>
    ${PARTS.map(p=>{
      const count=questionsFor(chosen,p).length;if(!count)return '';
      const groups=studyGroups(chosen,p),att=lastAttempt(chosen,p),d=getDraft(chosen,p);
      const status=groups.length>1?`${groups.filter((_,i)=>!!lastAttempt(chosen,p,i)).length}/${groups.length}セット採点済み`:
        (att?`直近 ${att.correct}/${att.total}問正解`:`${Object.keys(d.answers).length}/${count}問選択済`);
      return `<button class="navbtn ${active==='study'&&p===state.selectedSection?'active':''}" data-section="${p}" data-bank="${esc(chosen.bank_version)}">${PART_NAMES[p]}<small>${count}問 · ${status}</small></button>`;
    }).join('')}
    <button class="navbtn ${active==='mock'?'active':''}" data-view="mock">本番95問模試<small>科目A-1 90分／A-2・B 120分</small></button>
    <button class="navbtn ${active==='dashboard'?'active':''}" data-view="dashboard">成績ダッシュボード<small>全問題集・日付別・分野別</small></button>
    <button class="navbtn ${active==='history'?'active':''}" data-view="history">復習・全履歴<small>不正解・わからない・再演習</small></button>
    <button class="navbtn ${active==='cloud'?'active':''}" data-view="cloud">クラウド成績同期<small>${esc(cloud.statusBrief())}・Google Sheets</small></button>
  </div><div class="side-info"><b>${localRecords}</b>件の問題別記録<br>保存状態：${esc(storageMessage)}<hr>
    <button class="btn full" data-export="1">成績JSONをエクスポート</button>
    <p>新しい問題集を追加しても、このアプリの成績履歴は保持されます。別の端末やURLにはJSONで引き継いでください。</p></div>`;
}
  function renderChoices(q, answer, done) {
    const choices = q.options.map((option, i) => {
      const letter = LETTERS[i];
      const tone = done ? (letter === q.answer ? 'right-choice' : letter === answer ? 'wrong-choice' : '') : '';
      return `<label class="choice ${tone}"><input type="radio" data-question="${esc(q.question_id)}" name="answer-${esc(q.question_id)}" value="${letter}" ${answer === letter ? 'checked' : ''} ${done ? 'disabled' : ''}><b>${letter}</b><span>${esc(option)}</span></label>`;
    }).join('');
    return choices + `<label class="choice unknown-choice ${done && answer === '?' ? 'wrong-choice' : ''}"><input type="radio" data-question="${esc(q.question_id)}" name="answer-${esc(q.question_id)}" value="?" ${answer === '?' ? 'checked' : ''} ${done ? 'disabled' : ''}><b>?</b><span>わからない（回答済み・0点で別集計）</span></label>`;
  }
  function renderExplanation(q, answer) {
    const correct = answer === q.answer;
    const result = correct ? '正解' : answer === '?' ? 'わからない（0点）' : '不正解';
    return `<div class="explain"><div class="result-heading ${correct ? 'right-text' : 'wrong-text'}">${result}・正解：${esc(q.answer)} ${esc(q.options[LETTERS.indexOf(q.answer)])}</div>
      <details ${correct ? '' : 'open'}><summary>解説：判断根拠・全選択肢の評価・背景・実務応用</summary>
        <p><b>① 正解の判断根拠</b>　${esc(q.why)}</p>
        <p><b>② 全選択肢の評価</b></p><ul class="option-notes">${q.optionNotes.map((t, i) => `<li class="${LETTERS[i] === q.answer ? 'right-note' : ''}"><b>${LETTERS[i]} ${LETTERS[i] === q.answer ? '✓' : ''}</b> ${esc(t)}</li>`).join('')}</ul>
        <p><b>③ 技術的背景</b>　${esc(q.depth)}</p><p><b>④ 実務上の応用・注意</b>　${esc(q.application)}</p>
      </details></div>`;
  }
  function renderQuestion(q, index, answer, done) {
    return `<article class="question" data-question-id="${esc(q.question_id)}"><div class="question-meta"><span class="question-num">問${index + 1} ／ ${esc(q.question_id)}</span><span class="micro">${esc(q.major)} › ${esc(q.minor)} · ${esc(q.difficulty)}</span></div>
      ${q.case ? `<div class="case">${esc(q.case)}</div>` : ''}<div class="stem">${esc(q.stem)}</div>
      <div class="choices">${renderChoices(q, answer, done)}</div>${done ? renderExplanation(q, answer) : ''}</article>`;
  }
  function renderStudy(){
  const bank=currentBank(),part=state.selectedSection;if(!bank)return renderLibrary();
  const groups=studyGroups(bank,part),i=studyIndex(bank,part),qs=groups[i];
  if(!qs?.length)return `<div class="panel"><h2>この科目の問題はありません</h2><button class="btn" data-view="library">問題集を選ぶ</button></div>`;
  const a=lastAttempt(bank,part,i),done=!!a,d=getDraft(bank,part);
  const answers=done?Object.fromEntries(state.records.filter(r=>r.attempt_id===a.attempt_id).map(r=>[r.question_id,r.answer])):d.answers;
  const answered=qs.filter(q=>answers[q.question_id]).length,completed=groups.map((_,j)=>!!lastAttempt(bank,part,j));
  const firstMissing=completed.findIndex(ok=>!ok),maxOpen=firstMissing<0?groups.length-1:firstMissing;
  const overview=groups.length>1?`<div class="summary"><b>通常学習：セットごとに採点・解説</b><p>第${i+1}/${groups.length}セット（科目全体${groups.reduce((n,g)=>n+g.length,0)}問）。採点済み${completed.filter(Boolean).length}/${groups.length}セット。本番模試とは別の学習記録です。</p><div class="actions" role="group" aria-label="採点セットを切り替える">${groups.map((g,j)=>
    `<button class="btn ${j===i?'primary':''}" data-study-block="${j}" ${j>maxOpen?'disabled':''}>${j+1}：${g.length}問${completed[j]?' ✓':''}</button>`).join('')}</div></div>`:'';
  const offset=groups.slice(0,i).reduce((n,g)=>n+g.length,0);
  const banner=done?`<div class="metrics">${metric('今回の正答率',percentage(a.correct,a.total))}${metric('正解数',`${a.correct}/${a.total}`)}${metric('わからない',String(a.unknown))}${metric('採点日時',jpDate(a.submitted_at))}</div>
    <div class="pills">${qs.map((q,j)=>`<span class="pill ${answers[q.question_id]===q.answer?'pass':'fail'}">問${offset+j+1} ${answers[q.question_id]==='?'?'？':answers[q.question_id]===q.answer?'✓':'×'}</span>`).join('')}</div><p class="micro">誤答・わからないの解説は開いて表示します。正解問題の解説も展開できます。</p>`:
    `<div class="summary">このセットの${qs.length}問を選択すると採点できます。<b>採点確定まで正解を表示しません。</b><div class="progress"><span style="width:${100*answered/qs.length}%"></span></div><p>${answered}/${qs.length}問を選択済み</p></div>`;
  const nextPart=PARTS.slice(PARTS.indexOf(part)+1).find(p=>questionsFor(bank,p).length);
  const nextBlock=done&&i<groups.length-1,allDone=completed.every(Boolean);
  const actions=done?`<span class="micro">${groups.length>1?`第${i+1}セットの採点済み解説`:'採点済み・復習できます'}</span><div class="actions">
    <button class="btn" data-retry="1">このセットを再演習</button><button class="btn" data-view="dashboard">ダッシュボード</button>
    ${nextBlock?`<button class="btn primary" data-study-block="${i+1}">次の${groups[i+1].length}問へ</button>`:
      allDone&&nextPart?`<button class="btn primary" data-bank="${esc(bank.bank_version)}" data-section="${nextPart}">次の科目へ</button>`:
      allDone?`<button class="btn primary" data-view="library">他の問題集へ</button>`:''}</div>`:
    `<span class="micro">${answered}/${qs.length}問 回答済み</span><button id="submit-set" class="btn primary" data-submit="1" ${answered!==qs.length?'disabled':''}>${qs.length}問をまとめて採点</button>`;
  return `<div class="panel"><div class="head-row"><div><p class="eyebrow">${esc(bankLabel(bank))}</p><h2>${PART_NAMES[part]}</h2></div><span class="tag">${groups.length>1?`第${i+1}/${groups.length}セット · ${qs.length}問`:`${qs.length}問・1セット`}</span></div>
    ${overview}${banner}${qs.map((q,j)=>renderQuestion(q,offset+j,answers[q.question_id]||'',done)).join('')}
    <div class="sticky-actions">${actions}</div></div>`;
}
  function renderLibrary() {
    const rows = bankList().map(bank => {
      const attempted = state.attempts.filter(a => a.bank_version === bank.bank_version).length;
      return `<section class="library-bank"><div><div class="eyebrow">${esc(bank.audit_status)} · ${esc(bank.source || '保存済')}</div><h3>${esc(bankLabel(bank))}</h3><p class="micro">ID: ${esc(bank.bank_version)} ／ 問題数 ${bank.questions.length} ／ 採点済みセット数 ${attempted}</p><p class="micro">${esc(bank.source_notice)}</p></div><div class="actions">${PARTS.map(p => {
        const total = questionsFor(bank, p).length;
        return total ? `<button class="btn" data-bank="${esc(bank.bank_version)}" data-section="${p}">${p === 'A1' ? 'A-1' : p === 'A2' ? 'A-2' : 'B'} ${total}問</button>` : '';
      }).join('')}${isFullMock(bank) ? `<button class="btn primary" data-mock-start="${esc(bank.bank_version)}">本番95問模試を開始／再開</button>` : ''}</div></section>`;
    }).join('');
    return `<div class="panel"><div class="head-row"><div><p class="eyebrow">QUESTION CATALOG</p><h2>問題集ライブラリ</h2></div><span class="tag">${bankList().length}問題集</span></div>
      <p>新しく品質監査した問題集JSONを追加すれば、学習画面はそのままで新規セットが利用できます。過去の採点履歴は消しません。</p>
      <div class="actions"><button id="add-bank" class="btn primary" data-import-bank="1">問題集JSONを追加</button><button class="btn" data-sync="1">公開カタログを再読込</button></div>
      <p id="catalog-status" class="micro">カタログ：${esc(state.catalogStatus)}</p>
      <p class="micro">JSONの項目や解説の欠落・ID重複を検査します。ただし技術的な正確性・誤答の妥当性は自動で保証できません。品質監査済みのデータを追加してください。</p>
      <div class="library-list">${rows}</div></div>${renderBackupPanel()}`;
  }
  function renderDashboard() {
    const rows = chosenRecords(), major = state.reportMajor;
    const counted = rows.length, correct = rows.filter(r => r.correct).length, unknown = rows.filter(r => r.unknown).length;
    const majors = groupBy(rows, r => r.major), minors = groupBy(rows, r => `${r.major} › ${r.minor}`);
    const trendRecords = major === 'all' ? rows : rows.filter(r => r.major === major);
    const competent = majors.filter(r => r.n >= 2).sort((a, b) => b.c / b.n - a.c / a.n).slice(0, 3);
    const weak = majors.filter(r => r.n >= 2).sort((a, b) => a.c / a.n - b.c / b.n).slice(0, 3);
    const countByBank = groupBy(rows, r => state.banks[r.bank_version] ? bankLabel(state.banks[r.bank_version]) : r.bank_version);
    return `<div class="panel"><div class="head-row"><div><p class="eyebrow">LIFETIME LEARNING ANALYTICS</p><h2>成績ダッシュボード</h2></div><span class="tag">全問題集を横断</span></div>
      <div class="filter-bar"><label>試験区分 <select id="dashboard-exam-mode"><option value="learning" ${state.dashboardExamMode === 'learning' ? 'selected' : ''}>短時間・科目別演習</option><option value="mock" ${state.dashboardExamMode === 'mock' ? 'selected' : ''}>本番95問模試</option></select></label><label>集計対象 <select id="dashboard-bank"><option value="all">全問題集</option>${bankList().map(b => `<option value="${esc(b.bank_version)}" ${state.dashboardBank === b.bank_version ? 'selected' : ''}>${esc(bankLabel(b))}</option>`).join('')}</select></label>
      <label>科目 <select id="dashboard-section"><option value="all">すべて</option>${PARTS.map(p => `<option value="${p}" ${state.dashboardSection === p ? 'selected' : ''}>${PART_NAMES[p]}</option>`).join('')}</select></label>
      <label>記録区分 <select id="dashboard-mode"><option value="first" ${state.dashboardMode === 'first' ? 'selected' : ''}>初見（各問題の初回）</option><option value="all" ${state.dashboardMode === 'all' ? 'selected' : ''}>すべての演習</option><option value="latest" ${state.dashboardMode === 'latest' ? 'selected' : ''}>各問題の最新回答</option></select></label></div>
      <div class="metrics">${metric('正答率', percentage(correct, counted))}${metric('正解 / 解答', `${correct}/${counted}`)}${metric('わからない', `${unknown}件`)}${metric('わからない率', percentage(unknown, counted))}</div>
      <p class="micro">初見は「同じ問題集・問題ID・問題版」の最初の記録を指します。選択した試験区分だけを集計します。短時間演習と本番模試の成績は混ぜません。</p></div>
      <div class="panel"><h3>科目別・問題集別</h3><div class="subsection-title">科目別</div>${groupTable(groupBy(rows, r => PART_NAMES[r.section] || r.section))}<div class="subsection-title">問題集別</div>${groupTable(countByBank)}</div>
      <div class="panel"><h3>分野別・小分類別</h3>${groupTable(majors)}<details><summary>小分類別の成績を開く</summary>${groupTable(minors)}</details>
      <div class="subsection-title">得意分野・重点復習候補</div><p>得意候補：${competent.length ? competent.map(r => `${esc(r.name)}（${percentage(r.c, r.n)}・${r.n}件）`).join('、') : '集計に必要な回答がまだ不足しています'}</p>
      <p>重点復習候補：${weak.length ? weak.map(r => `${esc(r.name)}（${percentage(r.c, r.n)}・${r.n}件）`).join('、') : '集計に必要な回答がまだ不足しています'}</p><p class="micro">2問以上の分野を暫定評価。問題数が少ない場合は順位の信頼性が低いことに注意してください。</p></div>
      <div class="panel"><div class="head-row"><h3>日付別正答率の推移</h3><label class="micro">対象分野 <select id="report-major"><option value="all">全分野</option>${majors.map(m => `<option value="${esc(m.name)}" ${major === m.name ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label></div>
      ${dayGraph(trendRecords)}<h3>試験日・申込期間（公式確定後に設定）</h3><div class="filter-bar schedule"><label>試験日<input type="date" data-schedule="exam" value="${esc(state.schedule.exam)}"></label><label>申込開始日<input type="date" data-schedule="applicationFrom" value="${esc(state.schedule.applicationFrom)}"></label><label>申込終了日<input type="date" data-schedule="applicationTo" value="${esc(state.schedule.applicationTo)}"></label></div>
      <p class="micro">試験日はデータの右端以降の日付なら右端に表示し、申込期間は帯で表示します。公式情報の自動取得は行いません。</p></div>
      <div class="panel"><h3>過去との比較</h3>${recentTrend()}</div>${renderBackupPanel()}`;
  }
  function renderHistory() {
    const rows = [...state.records].sort((a, b) => (b.submitted_at || '').localeCompare(a.submitted_at || ''));
    const latest = new Map();
    for (const r of rows) if (!latest.has(recordQuestionKey(r))) latest.set(recordQuestionKey(r), r);
    const wrong = [...latest.values()].filter(r => !r.correct);
    const review = wrong.slice(0, 50).map(r => {
      const q = questionAt(r.bank_version, r.question_id, r.question_version);
      if (!q) return `<p class="micro">${esc(r.question_id)}（問題本文未登録） · ${r.unknown ? 'わからない' : '不正解'}</p>`;
      return `<details class="review" open><summary>${esc(r.question_id)} · ${esc(q.minor)} · ${r.unknown ? 'わからない' : '不正解'}</summary><p class="stem">${esc(q.stem)}</p>${renderExplanation(q, r.answer)}</details>`;
    }).join('');
    return `<div class="panel"><div class="head-row"><h2>復習・全履歴</h2><span class="tag">${rows.length}記録</span></div><p class="micro">最新の回答が不正解・「わからない」の問題を復習できます。古い記録も削除されません。</p>
      <h3>重点復習 ${wrong.length}問</h3>${wrong.length ? review : '<p class="empty">現在、重点復習の対象はありません。</p>'}
      <h3>問題単位の採点履歴</h3><div class="tablewrap"><table><thead><tr><th>日時</th><th>問題集・ID・版</th><th>科目・分類</th><th>区分</th><th>回答</th><th>正誤</th></tr></thead><tbody>${rows.slice(0, 300).map(r => `<tr><td>${esc(jpDate(r.submitted_at))}</td><td><span class="micro">${esc(r.bank_version)}</span><br>${esc(r.question_id)} / ${esc(r.question_version)}</td><td>${esc(r.section)} · ${esc(r.major)} › ${esc(r.minor)}</td><td>${r.mode === 'mock' ? '模試' : '演習'}・${r.is_first_seen ? '初見' : '再演習'}</td><td>${r.unknown ? 'わからない' : esc(r.answer)}</td><td>${r.correct ? '正解' : r.unknown ? 'わからない' : '不正解'}</td></tr>`).join('')}</tbody></table></div>${rows.length > 300 ? `<p class="micro">画面は最新300件を表示中（${rows.length}件の記録はJSONにすべて保存）。</p>` : ''}</div>${renderBackupPanel()}`;
  }
  function renderBackupPanel() {
    return `<div class="panel"><h3>成績の保存・移行</h3><p>このアプリは成績をブラウザ内に保存します。JSONバックアップには、履歴と登録済み問題集の両方を収録します。</p>
      <div class="actions"><button class="btn primary" data-export="1">全成績・問題集をJSON出力</button><button class="btn" data-import-records="1">成績JSONを取込み（追記）</button></div>
      <p class="micro">旧15問アプリ形式、旧95問v2形式、共通アプリ形式に対応。記録IDが同じ行は重複排除し、内容が異なれば拒否します。URLを変えたり、別端末へ移すときは出力JSONが必要です。クラウド同期は左メニュー「クラウド成績同期」から設定できます。</p></div>`;
  }
  function render() {
    $('side').innerHTML = renderSidebar();
    const view = state.view;
    $('main').innerHTML = view === 'dashboard' ? renderDashboard() : view === 'history' ? renderHistory() : view === 'library' ? renderLibrary() : view === 'cloud' ? cloud.render() : view === 'mock' ? renderMock() : renderStudy();
  }

  function exportJSON() {
    const contents = { ...state, exported_at: new Date().toISOString(), export_format: 'ipa-unified-backup-v1' };
    const blob = new Blob([JSON.stringify(contents, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `IPA_SYSTEM_ALL_RECORDS_${localDate()}.json`;
    document.body.append(link);
    link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    notify(`成績 ${state.records.length}件・問題集 ${bankList().length}件をJSON出力しました`);
  }
  function legacyV2Backup(x) {
    const body = x?.state?.version === 'ipa-pds-95-revised-v2' ? x.state : x;
    if (body?.version !== 'ipa-pds-95-revised-v2' || !body.answers || !body.submitted)
      throw new Error('旧95問バックアップの形式に一致しません');
    const result = { records: [], attempts: [], schedule: {
      exam: body.exam || '', applicationFrom: body.applicationFrom || '', applicationTo: body.applicationTo || ''
    } };
    for (let i = 0; i < LEGACY.groups.length; i++) {
      const submitted = body.submitted[String(i)];
      if (!submitted) continue;
      const group = LEGACY.groups[i];
      const when = submitted.submittedAt || `${submitted.date}T12:00:00+09:00`;
      const day = submitted.date || localDate(new Date(when));
      const attempt_id = `legacy-v2-${i}-${day}`;
      let correct = 0, unknown = 0;
      for (const q of LEGACY.questions.slice(group.from, group.to)) {
        const answer = body.answers[q.id];
        if (!['A', 'B', 'C', 'D', '?'].includes(answer)) throw new Error(`旧問題 ${q.id} に採点済み回答がありません`);
        correct += Number(answer === q.answer);
        unknown += Number(answer === '?');
        result.records.push({
          record_id: `legacy-v2-${i}-${q.id}-${day}`, attempt_id,
          bank_version: 'ipa-pds-95-revised-v2', question_id: q.id, question_version: '2.0.0',
          section: q.section, major: q.major, minor: q.minor, difficulty: '未設定（旧版）',
          answer, correct: answer === q.answer, unknown: answer === '?', mode: 'learning',
          is_first_seen: true, answered_at: when, submitted_at: when, answer_date: day, elapsed_seconds: null
        });
      }
      result.attempts.push({ attempt_id, bank_version: 'ipa-pds-95-revised-v2', section: group.section,
        submitted_at: when, answer_date: day, total: group.to - group.from, correct, unknown, mode: 'learning' });
    }
    return result;
  }
  function validRecord(record) {
    if (!record || typeof record.record_id !== 'string' || !record.record_id ||
        typeof record.attempt_id !== 'string' || !record.attempt_id ||
        !record.bank_version || !record.question_id || !record.question_version ||
        !PARTS.includes(record.section) || !['A', 'B', 'C', 'D', '?'].includes(record.answer) ||
        typeof record.correct !== 'boolean' || typeof record.unknown !== 'boolean' ||
        !record.submitted_at || !isDate(record.answer_date) || !record.major || !record.minor)
      throw new Error('成績行の必須項目が不足しています');
    if (record.unknown !== (record.answer === '?') || (record.unknown && record.correct))
      throw new Error('成績行の「わからない」と正誤が矛盾しています');
  }
  function validAttempt(attempt) {
    if (!attempt || !attempt.attempt_id || !attempt.bank_version || !PARTS.includes(attempt.section) ||
        !Number.isInteger(attempt.total) || !Number.isInteger(attempt.correct) ||
        !Number.isInteger(attempt.unknown) || attempt.total < 1 || attempt.correct < 0 ||
        attempt.unknown < 0 || attempt.correct + attempt.unknown > attempt.total || !attempt.submitted_at)
      throw new Error('採点セットの形式に問題があります');
  }
  function stableRecord(r) {
    // UI-specific or legacy-specific optional fields may be absent; compare core immutable data.
    return ['record_id', 'attempt_id', 'bank_version', 'question_id', 'question_version',
      'section', 'major', 'minor', 'answer', 'correct', 'unknown', 'submitted_at', 'answer_date']
      .map(k => JSON.stringify(r[k])).join('|');
  }
  function mergeRecords(incoming) {
    if (!Array.isArray(incoming.records) || !Array.isArray(incoming.attempts))
      throw new Error('成績データにはrecordsとattemptsが必要です');
    const original = new Map(state.records.map(r => [r.record_id, r]));
    const seen = new Map();
    for (const record of incoming.records) {
      validRecord(record);
      const prev = seen.get(record.record_id) || original.get(record.record_id);
      if (prev && stableRecord(prev) !== stableRecord(record))
        throw new Error(`同じ記録IDに異なる成績が指定されています：${record.record_id}`);
      seen.set(record.record_id, record);
      const bank = state.banks[record.bank_version] || incoming.banks?.[record.bank_version];
      if (bank) {
        const q = bank.questions.find(z => z.question_id === record.question_id && z.question_version === record.question_version);
        if (!q) throw new Error(`記録に対応する問題版が存在しません：${record.question_id}`);
        if (record.correct !== (record.answer === q.answer))
          throw new Error(`正解と成績が一致しません：${record.question_id}`);
      }
    }
    const attemptsById = new Map(state.attempts.map(a => [a.attempt_id, a]));
    const importAttempts = new Map();
    for (const attempt of incoming.attempts) {
      validAttempt(attempt);
      const prior = attemptsById.get(attempt.attempt_id) || importAttempts.get(attempt.attempt_id);
      if (prior && (prior.total !== attempt.total || prior.correct !== attempt.correct || prior.unknown !== attempt.unknown || prior.bank_version !== attempt.bank_version))
        throw new Error(`同じ採点IDの件数が不一致です：${attempt.attempt_id}`);
      importAttempts.set(attempt.attempt_id, attempt);
    }
    const additions = [...seen.values()].filter(r => !original.has(r.record_id));
    const newAttempts = [...importAttempts.values()].filter(a => !attemptsById.has(a.attempt_id));
    state.records.push(...additions);
    state.attempts.push(...newAttempts);
    for (const key of ['exam', 'applicationFrom', 'applicationTo'])
      if (!state.schedule[key] && incoming.schedule?.[key]) state.schedule[key] = incoming.schedule[key];
    return { added: additions.length, attempts: newAttempts.length, duplicates: incoming.records.length - additions.length };
  }
  function parseRecordJSON(x) {
    if (x?.version === 'ipa-pds-95-revised-v2' || x?.state?.version === 'ipa-pds-95-revised-v2')
      return legacyV2Backup(x);
    if (!['ipa-study-records-1', SCHEMA].includes(x?.schema_version)) throw new Error('対応していない成績JSON形式です');
    if (!Array.isArray(x.records) || !Array.isArray(x.attempts)) throw new Error('成績のrecords/attemptsが不正です');
    return x;
  }
  async function importRecordFile(file) {
    if (!file) return;
    try {
      const parsed = parseRecordJSON(JSON.parse(await file.text()));
      const incomingBanks = parsed.banks ? Object.values(parsed.banks).map(normalizedBank) : [];
      // preflight on isolated copies to avoid partially modifying state.
      const before = state;
      const testState = JSON.parse(JSON.stringify(state));
      state = testState;
      let result;
      try {
        registerBanks(incomingBanks, '成績バックアップから復元');
        result = mergeRecords(parsed);
      } finally { state = before; }
      ask(`問題別記録${parsed.records.length}件から${result.added}件を追加し、問題集${incomingBanks.length}件を確認します。既存の履歴は保持します。続けますか？`, () => {
        registerBanks(incomingBanks, '成績バックアップから復元');
        const finalResult = mergeRecords(parsed);
        persist(); render(); notify(`成績を${finalResult.added}件追加、重複${finalResult.duplicates}件を除外しました`);
      });
    } catch (e) { reportError(e); }
    finally { $('record-file').value = ''; }
  }
  async function importBankFiles(files) {
    if (!files?.length) return;
    try {
      const input = [];
      for (const file of files) {
        const raw = JSON.parse(await file.text());
        input.push(...(Array.isArray(raw) ? raw : [raw]));
      }
      // Validate every file before inserting any new bank.
      const normalized = input.map(normalizedBank);
      for (const bank of normalized) if (state.banks[bank.bank_version] && !sameBank(state.banks[bank.bank_version], bank))
        throw new Error('既存bank_versionと設問内容が異なるため取込みできません');
      ask(`${normalized.length}問題集を登録します。形式を検査しましたが、問題内容の品質は別途監査が必要です。登録しますか？`, () => {
        const added = registerBanks(normalized, '手動JSON取込み');
        if (added) {
          state.selectedBank = normalized[0].bank_version;
          state.selectedSection = PARTS.find(p => questionsFor(state.banks[normalized[0].bank_version], p).length) || 'A1';
        }
        persist(); render(); notify(`問題集${added}件を追加しました（既登録${normalized.length - added}件）`);
      });
    } catch (e) { reportError(e); }
    finally { $('bank-file').value = ''; }
  }
  async function syncCatalog() {
    if (!['http:', 'https:'].includes(location.protocol)) {
      state.catalogStatus = 'ローカルHTMLでは公開カタログを自動読込できません。JSON追加を利用してください';
      persist(); render(); return;
    }
    state.catalogStatus = '公開カタログを確認中'; render();
    try {
      const response = await fetch('./catalog/manifest.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`manifest: HTTP ${response.status}`);
      const manifest = await response.json();
      if (manifest.schema_version !== 'ipa-study-catalog-manifest-v1' || !Array.isArray(manifest.banks))
        throw new Error('manifest.jsonの形式が不正です');
      const downloaded = [];
      for (const entry of manifest.banks) {
        if (typeof entry.file !== 'string' || !/^catalog\/[a-zA-Z0-9._\/-]+\.json$/.test(entry.file) || entry.file.includes('..'))
          throw new Error('不正な公開問題集パスが含まれています');
        const res = await fetch(`./${entry.file}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`${entry.file}: HTTP ${res.status}`);
        const bank = await res.json();
        if (entry.bank_version && entry.bank_version !== bank.bank_version)
          throw new Error(`${entry.file}: bank_versionがmanifestと一致しません`);
        if (entry.audit_status) bank.audit_status = entry.audit_status;
        downloaded.push(bank);
      }
      const count = registerBanks(downloaded, '公開カタログ');
      state.catalogStatus = `確認済み：${downloaded.length}問題集（今回追加${count}件）`;
      persist(); render();
      if (count) notify(`公開カタログから新しい問題集を${count}件追加しました`);
    } catch (e) {
      state.catalogStatus = `更新失敗：${e.message}（ローカル履歴・登録済問題は保持）`;
      render(); notify(state.catalogStatus, true);
    }
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    try {
      if (button.dataset.modal) { completeAsk(button.dataset.modal === 'yes'); return; }
      if (!$('modal').hidden) return;
      if (button.dataset.mockStart) startMock(button.dataset.mockStart);
      else if (button.dataset.mockPhase) submitMockPhase();
      else if (button.dataset.mockFinalize) submitMockFinal();
      else if (button.dataset.mockRetake) retakeMock();
      else if (button.dataset.mockReview) showMockReview(button.dataset.mockReview);
      else if (button.dataset.studyBlock !== undefined) selectStudyBlock(Number(button.dataset.studyBlock));
      else if (button.dataset.section && button.dataset.bank) openSet(button.dataset.bank, button.dataset.section);
      else if (button.dataset.view) switchView(button.dataset.view);
      else if (button.dataset.submit) submitSet();
      else if (button.dataset.retry) retrySet();
      else if (button.dataset.export) exportJSON();
      else if (button.dataset.importBank) $('bank-file').click();
      else if (button.dataset.importRecords) $('record-file').click();
      else if (button.dataset.sync) syncCatalog();
      else if (button.dataset.cloud) void cloud.onAction(button.dataset.cloud);
    } catch (e) { reportError(e); }
  });
  document.addEventListener('change', event => {
    const field = event.target;
    try {
      if (field.matches('input[data-mock-answer]')) selectMockAnswer(field.dataset.mockAnswer, field.value);
      else if (field.matches('input[data-question]')) selectAnswer(field.dataset.question, field.value);
      else if (field.id === 'dashboard-exam-mode') { state.dashboardExamMode = field.value === 'mock' ? 'mock' : 'learning'; persist(); render(); }
      else if (field.id === 'dashboard-mode') { state.dashboardMode = field.value; persist(); render(); }
      else if (field.id === 'dashboard-bank') { state.dashboardBank = field.value; state.reportMajor = 'all'; persist(); render(); }
      else if (field.id === 'dashboard-section') { state.dashboardSection = field.value; state.reportMajor = 'all'; persist(); render(); }
      else if (field.id === 'report-major') { state.reportMajor = field.value; persist(); render(); }
      else if (field.dataset.schedule) { state.schedule[field.dataset.schedule] = field.value; persist(); render(); }
    } catch (e) { reportError(e); }
  });
  $('bank-file').addEventListener('change', e => importBankFiles([...e.target.files]));
  $('record-file').addEventListener('change', e => importRecordFile(e.target.files[0]));
  hydrate(); render(); syncCatalog();
  setInterval(() => {
    if (state.view !== 'mock') return;
    const session = activeMock();
    if (!session || session.phase === 'done') return;
    const remaining = remainingSeconds(session);
    const clock = $('mock-clock');
    if (clock) clock.textContent = clockLabel(remaining);
    if (remaining <= 0 && !confirmationBusy && $('modal').hidden) {
      try { closeMockPhase(true); } catch (e) { reportError(e); }
    }
  }, 1000);
  // Expose a limited read-only state summary for local automated diagnostics.
  Object.defineProperty(window, '__IPA_APP_STATUS__', {
    get: () => ({ banks: bankList().length, records: state.records.length,
      attempts: state.attempts.length, storageMessage, catalogStatus: state.catalogStatus })
  });
})();
