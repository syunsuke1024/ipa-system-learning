#!/usr/bin/env python3
"""監査済み新問題集を壊さずにカタログへ追記する。初期はドライラン、--apply で保存。"""
import argparse
import json
import re
import shutil
import tempfile
from pathlib import Path
from verify_catalog import verify, validate_pair

def add_bank(repo, bank_file, audit_file, slug, apply=False):
    repo=repo.resolve()
    bank=json.loads(bank_file.read_text(encoding='utf-8'))
    audit=json.loads(audit_file.read_text(encoding='utf-8'))
    result=validate_pair(bank,audit)
    if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9][a-z0-9_-]{2,72}',slug):
        raise ValueError('slugは YYYY-MM-DD-英小文字・数字・ハイフン形式にしてください')
    new_bank=f'catalog/{slug}.json'
    new_audit=f'audits/{slug}-audit.json'
    if (repo/new_bank).exists() or (repo/new_audit).exists():
        raise ValueError('出力先が既に存在します。上書きしません')
    current=json.loads((repo/'catalog/manifest.json').read_text(encoding='utf-8'))
    if any(row['bank_version']==result['bank_version'] for row in current['banks']):
        raise ValueError('登録済みbank_versionです。改訂は新規バージョンにしてください')
    entry={
      'file':new_bank,
      'bank_version':result['bank_version'],
      'audit_status':str(bank.get('audit_status') or '品質監査済み（内部監査）'),
      'audit_file':new_audit,
    }
    updated={**current,'banks':current['banks']+[entry]}
    # 全カタログへの影響を一時ディレクトリで検証し、既存ファイルを1byteも変更しない。
    with tempfile.TemporaryDirectory(prefix='ipa-catalog-check-') as tmp:
        shadow=Path(tmp)/'repo'
        shutil.copytree(repo,shadow,ignore=shutil.ignore_patterns('.git','__pycache__','.pytest_cache','*.zip'))
        (shadow/new_bank).parent.mkdir(parents=True,exist_ok=True)
        (shadow/new_audit).parent.mkdir(parents=True,exist_ok=True)
        (shadow/new_bank).write_text(json.dumps(bank,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        (shadow/new_audit).write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        (shadow/'catalog/manifest.json').write_text(json.dumps(updated,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        verify(shadow)
    print('PASS: 既存問題集と新規監査済問題集の構造・ID・版・監査証跡が整合')
    print('追加問題集:',result['bank_version'],'／',result['sections'])
    print('追加予定:',new_bank, new_audit, 'catalog/manifest.json の追記')
    if not apply:
        print('ドライラン完了（ファイルは変更していません）。保存する場合は --apply を指定してください。')
        return updated
    (repo/new_bank).write_text(json.dumps(bank,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (repo/new_audit).write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    manifest_path=repo/'catalog/manifest.json'
    # 一連の事前検証成功後に、最後にカタログ参照を書き換える。
    temp_path=repo/'catalog/manifest.json.tmp'
    temp_path.write_text(json.dumps(updated,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    temp_path.replace(manifest_path)
    print('APPLIED: 新規問題集を追加。既存問題集・成績記録は変更していません。')
    return updated

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[1])
    p.add_argument('--bank',required=True,type=Path)
    p.add_argument('--audit',required=True,type=Path)
    p.add_argument('--slug',required=True)
    p.add_argument('--apply',action='store_true',help='事前検証を通過したらカタログに追記する')
    args=p.parse_args()
    try: add_bank(args.repo,args.bank,args.audit,args.slug,args.apply)
    except Exception as exc:
        p.exit(1,'FAIL: '+str(exc)+'\n')
