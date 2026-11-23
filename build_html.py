from pathlib import Path
import json
src=Path(__file__).resolve().parent
legacy=json.loads((src/'catalog'/'legacy_v2_metadata.json').read_text(encoding='utf-8'))
seed=json.loads((src/'catalog'/'2026-11-22-quality15.json').read_text(encoding='utf-8'))
new_js=(src/'app.js').read_text(encoding='utf-8')
cloud_js=(src/'cloud_sync.js').read_text(encoding='utf-8')
assert all(word not in (new_js+cloud_js) for word in ('window.confirm(', 'window.alert(', 'window.prompt('))
style=(src/'style.css').read_text(encoding='utf-8')
seed_json=json.dumps(seed,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')
legacy_json=json.dumps(legacy,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')
html=f'''<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>IPA システム領域｜共通学習アプリ v1</title><meta name="description" content="IPAシステム領域の品質監査済み予想問題と累積成績を一元管理する学習アプリ">
<style>{style}</style><script async src="https://accounts.google.com/gsi/client"></script></head>
<body><header><div class="inner"><p class="eyebrow">IPA SYSTEM / CONTINUOUS LEARNING</p><h1>システム領域｜共通学習アプリ</h1>
<p>問題集を追加しても、過去の採点履歴とダッシュボードは継続。A-1・A-2・Bに対応します。</p><span class="top-chip">非公式オリジナル予想問題 · 共通版 v1.0</span></div></header>
<div class="shell"><aside class="side" id="side" aria-label="学習メニュー"></aside><main class="main" id="main" tabindex="-1"></main></div>
<footer>本アプリはIPAの公式問題・採点システムではありません。試験の形式・日程・配点は公表情報で確認してください。問題品質の自動検証には限界があります。<br>記録は利用環境のブラウザ領域に保存されます。GitHub Pagesなどの同一URLでの運用を推奨します。ブラウザ内保存とプロジェクト共通への永続保存は別です。</footer>
<div id="modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-message" hidden><div class="modal-card"><h2 id="modal-title">操作の確認</h2><p id="modal-message"></p><div class="actions"><button type="button" class="btn" data-modal="no">キャンセル</button><button type="button" class="btn primary" id="modal-yes" data-modal="yes">確定する</button></div></div></div>
<div id="notice" class="notice" role="status" aria-live="polite" hidden></div>
<input type="file" accept="application/json,.json" multiple hidden id="bank-file" aria-label="問題集JSONファイル">
<input type="file" accept="application/json,.json" hidden id="record-file" aria-label="成績JSONファイル">
<script type="application/json" id="seed-bank">{seed_json}</script>
<script type="application/json" id="legacy-meta">{legacy_json}</script>
<script>{cloud_js}</script><script>{new_js}</script></body></html>
'''
(src/'index.html').write_text(html,encoding='utf-8')
(src/'catalog'/'2026-11-22-quality15.json').write_text(json.dumps(seed,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
# catalog/manifest.json は運用データ。HTMLの再ビルドで上書きしない。
manifest_path=src/'catalog'/'manifest.json'
if not manifest_path.exists():
    manifest={'schema_version':'ipa-study-catalog-manifest-v1', 'banks':[
        {'file':'catalog/2026-11-22-quality15.json','bank_version':seed['bank_version'], 'audit_status':seed.get('audit_status','内部監査済み')}
    ]}
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
else:
    manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
    if manifest.get('schema_version')!='ipa-study-catalog-manifest-v1' or not any(
        b.get('bank_version') == 'ipa-pds-system-full95-editorial-20261123-v4'
        for b in manifest.get('banks',[])):
        raise ValueError('公開カタログに95問セットの参照がありません。manifestを勝手に再作成しません')
print('Created html size:',len(html), 'legacy groups:',len(legacy.get('groups',[])), 'bankQs',len(seed['questions']))
