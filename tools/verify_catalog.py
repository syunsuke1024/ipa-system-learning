#!/usr/bin/env python3
"""公開問題カタログの構造・監査証跡・非公開データ混入を検証する（意味的品質は人が監査）。"""
import argparse
import json
import re
from collections import Counter
from pathlib import Path

ACCEPTED = {'A1','A2','B'}
REQUIRED = ('question_id','question_version','section','major','minor','difficulty','stem','options',
            'answer','why','optionNotes','depth','application')

def insist(condition, message):
    if not condition:
        raise ValueError(message)

def text_field(v):
    return isinstance(v, str) and bool(v.strip())

def safe_file(root, value, parent):
    insist(isinstance(value,str) and re.fullmatch(r'[a-zA-Z0-9_./-]+\.json',value) and
           value.startswith(parent+'/') and '..' not in value and '\\' not in value,
           f'不正なファイルパス: {value!r}')
    p=(root / value).resolve()
    insist(p.is_relative_to((root/parent).resolve()), f'公開領域外のパス: {value}')
    insist(p.is_file(), f'ファイルがありません: {value}')
    return p

def json_file(path):
    return json.loads(path.read_text(encoding='utf-8'))

def validate_pair(bank, audit, expected_version=None):
    version=bank.get('bank_version')
    insist(text_field(version), 'bank_version がありません')
    if expected_version is not None:
        insist(version == expected_version, f'問題集バージョンが一致しません: {version}')
    qs=bank.get('questions')
    insist(isinstance(qs,list) and 1<=len(qs)<=500, f'{version}: 問題数が不正です')
    seen=set()
    for q in qs:
        ident=q.get('question_id')
        insist(all(text_field(q.get(field)) for field in REQUIRED if field not in ('options','optionNotes')),
               f'{version}/{ident}: 必須項目が不正です')
        insist(q['section'] in ACCEPTED, f'{ident}: 科目が不正')
        insist(isinstance(q.get('options'),list) and len(q['options'])==4 and all(map(text_field,q['options'])),
               f'{ident}: 選択肢が4件でないか空です')
        insist(isinstance(q.get('optionNotes'),list) and len(q['optionNotes'])==4 and all(map(text_field,q['optionNotes'])),
               f'{ident}: 個別解説が4件でないか空です')
        insist(q['answer'] in 'ABCD' and len(q['answer'])==1, f'{ident}: 正答位置が不正')
        insist(q['section'] != 'B' or text_field(q.get('case')), f'{ident}: B問題の業務事例がありません')
        key=(ident,q['question_version'])
        insist(key not in seen, f'{ident}: 同一版の問題IDが重複')
        seen.add(key)
    insist(audit.get('bank_version')==version, f'{version}: 監査対象バージョン不一致')
    insist(audit.get('total_questions')==len(qs), f'{version}: 監査の問題数不一致')
    rows=audit.get('per_question')
    insist(isinstance(rows,list) and len(rows)==len(qs), f'{version}: 問題別監査が不足')
    amap={q.get('question_id'):q for q in rows}
    insist(len(amap)==len(rows) and set(amap)=={q['question_id'] for q in qs},
           f'{version}: 問題別監査の問題IDが不一致')
    for q in qs:
        ident=q['question_id']; row=amap[ident]
        insist(all(str(row.get('gate_'+g,'')).startswith('PASS') for g in ('Q1','Q2','Q4')),
               f'{ident}: 必須品質ゲートがPASSではありません')
        insist(isinstance(row.get('quality_score_out_of_10'),(int,float)) and
               8 <= row['quality_score_out_of_10']<=10, f'{ident}: 品質評価8点未満または範囲外')
        insist(row.get('answer')==q['answer'], f'{ident}: 監査記載の正答が異なります')
    return {'bank_version':version,'questions':len(qs), 'sections':dict(Counter(q['section'] for q in qs)),
            'audit':audit.get('qa_type','不明')}

def verify(root):
    root=Path(root).resolve()
    manifest=json_file(root/'catalog/manifest.json')
    insist(manifest.get('schema_version')=='ipa-study-catalog-manifest-v1', 'manifest schemaが不正')
    entries=manifest.get('banks')
    insist(isinstance(entries,list) and entries, 'manifestのbanksが空です')
    seen_versions=set()
    seen_questions={}
    results=[]
    for entry in entries:
        version=entry.get('bank_version')
        insist(text_field(version) and version not in seen_versions, 'manifest内のbank_version重複・不足')
        seen_versions.add(version)
        file=safe_file(root,entry.get('file'),'catalog')
        audit_file=safe_file(root,entry.get('audit_file'),'audits')
        bank=json_file(file)
        audit=json_file(audit_file)
        results.append(validate_pair(bank,audit,version))
        for q in bank['questions']:
            key=(q['question_id'],q['question_version'])
            insist(key not in seen_questions, f'異なる問題集で同一ID/版を再利用: {key}, {seen_questions.get(key)} と {version}')
            seen_questions[key]=version
    # 配信成果物とその保守資材のJSが標準ダイアログを利用しないことを静的検査。
    for file in (root/'app.js', root/'cloud_sync.js', root/'index.html'):
        s=file.read_text(encoding='utf-8')
        insist(not re.search(r'\b(?:window\s*\.\s*)?(?:alert|confirm|prompt)\s*\(',s),
               f'標準ブラウザダイアログ呼出しが残っています: {file.name}')
    # 成績エクスポートや機密設定を一般公開カタログに紛れ込ませない。
    public_files=[root/'index.html', *(root/'catalog').rglob('*.json')]
    for file in public_files:
        insist(file.exists(),f'公開ファイル不存在: {file}')
        if file.suffix=='.json' and file.name!='legacy_v2_metadata.json':
            j=json_file(file)
            insist(not(isinstance(j,dict) and j.get('schema_version')=='ipa-unified-study-1'),
                   f'公開領域に成績データがあります: {file}')
    return results

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repo',nargs='?',default=Path(__file__).resolve().parents[1],type=Path)
    args=parser.parse_args()
    try:
        res=verify(args.repo)
    except Exception as e:
        print('FAIL:',e)
        raise SystemExit(1)
    print('PASS: '+str(len(res))+'問題集、'+str(sum(r['questions'] for r in res))+'問、監査証跡とカタログ整合を検査')
    for r in res: print(' -',r['bank_version'],r['sections'],r['audit'])
    print('注: Q1/Q2/Q4の意味的正しさは監査記録を検査したのみ。独立再監査ではありません。')
