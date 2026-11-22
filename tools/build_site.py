#!/usr/bin/env python3
"""GitHub Pages用の公開成果物だけを dist/ に組み立てる。"""
import json
import shutil
from pathlib import Path
from verify_catalog import verify

root=Path(__file__).resolve().parents[1]
verified=verify(root)
site=root/'dist'
if site.exists(): shutil.rmtree(site)
site.mkdir(parents=True)
shutil.copy2(root/'index.html',site/'index.html')
(site/'.nojekyll').write_text('',encoding='utf-8')
manifest=json.loads((root/'catalog/manifest.json').read_text(encoding='utf-8'))
(site/'catalog').mkdir()
shutil.copy2(root/'catalog/manifest.json',site/'catalog/manifest.json')
for row in manifest['banks']:
    src=root/row['file'];dest=site/row['file'];dest.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(src,dest)
print('公開用成果物を生成:',site)
print('公開対象:',len(verified),'問題集、',sum(i['questions'] for i in verified),'問')
print('成績JSONは成果物に含めていません')
