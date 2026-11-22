# IPAシステム領域｜共通学習アプリ v1.1（GitHub Pages連携準備版）

作成日：2026-11-22。IPA公式アプリではありません。**このリポジトリには学習成績JSONや個人情報を登録しないでください。**

## 目的と現在の状態

- 同じ学習アプリURLから品質監査済み問題集を追加して利用できるようにする。
- 回答→科目単位の採点→全選択肢の解説→問題別成績→全問題集の横断ダッシュボード。
- 各ブラウザの `localStorage` に成績を蓄積し、JSONで書出し・取込みを行う。
- 公開カタログに登録された新問題集JSONをサイトから読み込む。
- GitHub Actionsが問題集の**構造**と品質監査記録の存在・内容整合を確認した後、Pagesへデプロイする。**技術的な正解の一意性や難易度は自動検証できず、監査証跡の内容は作問時の自己評価です。**

現在のサイト公開先は**未設定**です。GitHubにIPA専用リポジトリを作成する必要があります。

## 初回公開手順（Windows + Git）

1. GitHubで [New repository](https://github.com/new) を開き、所有者を自分のアカウント、名前を `ipa-system-learning` として新規作成する。無料のGitHub Pagesを利用する場合は **Public** を選ぶ（問題・正解・解説は全世界から閲覧可能）。**「Add a README」「.gitignore」「Choose a license」は選ばず空のリポジトリにする**。
2. このZIPを任意の新規フォルダへ解凍し、PowerShellで解凍後フォルダへ移動する。直下に `index.html`、`catalog/`、`.github/workflows/pages.yml` があることを確認する。
3. 次のコマンドを実行する（アカウントとリポジトリ名は実際の作成先に合わせる）。

   ```powershell
   git init
   git branch -M main
   git add .
   git commit -m "Publish IPA common learning app"
   git remote add origin https://github.com/syunsuke1024/ipa-system-learning.git
   git push -u origin main
   ```

4. GitHubリポジトリの `Settings` → `Pages` → `Build and deployment` → `Source` を **GitHub Actions** に変更する。`Actions`で `Validate and publish IPA learning app` が成功したことを確認する。必要に応じ、手動で `Run workflow` を実行する。
5. GitHub `Settings` → `Pages` で実際の公開URLを確認する。通常は `https://syunsuke1024.github.io/ipa-system-learning/` の形式。**公開確認前はこのURLを稼働中と断定しない。**
6. 新しいPages URLを初回利用するときは、以前のHTMLで「成績JSONをエクスポート」し、Pages側で「成績JSONをインポート」する。**保存領域はURL/オリジンごとに分離するため、過去のHTMLから自動転送しない。**

> `.github/workflows/pages.yml` は、1回のPushで`verify_catalog.py`、HTML再ビルドの差分確認、Playwrightによる28項目の回帰テスト、Pages用成果物生成を行ってからデプロイする。`dist/` と個人記録はサイトに含めない。

## 普段の使い方

- 問題集は科目A-1（共通）、A-2（専門）、B（応用）を分離して解答する。各科目で回答が揃うと、HTML内の確認画面を経由して採点できる。
- 「わからない」は回答済み・0点。未正答と「わからない」の解説は採点後に初期展開する。正答の解説も閲覧できる。
- 同じPages URLを同じブラウザプロフィールで使い続ける限り、通常は同じ保存領域を使用できる。ただし履歴の永続性を保証するクラウド同期はない。**定期的にJSONをバックアップすること。**
- 新しい問題集を公開したらページを再読込み、または「公開カタログを再読込」を押す。公開の反映まではキャッシュやGitHub Actions実行に伴う時間差があり得る。

## 新しいチャットで問題を追加する方法

1. ChatGPTプロジェクト内で「演習開始」と入力する。共通資料、既出問題と、**アクセスできる範囲の成績**を確認して標準15問（A-1:10、A-2:3、B:2）を新規作成する。
2. Q1/Q2/Q4必須ゲートと10点監査（8点以上）を**1問ずつ**通し、問題集JSONと監査JSONの2つを用意する。Q1等は意味的な人手監査が必要。
3. ローカルで追加するときはまず検証のみ：

   ```powershell
   python tools/register_bank.py --bank .\new-bank.json --audit .\new-audit.json --slug 2026-11-29-week02
   ```

   合格後、同じコマンドに `--apply` を付ける。`catalog/` と `audits/` に新ファイルが追加され、`catalog/manifest.json` の **末尾にだけ**参照が増える。次に `python tools/verify_catalog.py`、`git add catalog audits`、`git commit`、`git push` を行う。
4. GitHub接続済みのChatGPTから登録する場合は、`catalog/<新規>.json` と `audits/<新規>-audit.json` をそれぞれ新規ファイルとして作り、**両方をGitHub上で再読込確認した後**に `catalog/manifest.json` へ参照を追加する。`Actions` の成功確認前は「公開済み」と報告しない。
5. 作成済みの `bank_version` や同じ問題ID/版を使い回さない。問題の修正は必ず別のバージョンとして扱う。

このコネクタ運用で **ChatGPTがローカルブラウザの成績を自動取得することはできません**。苦手分野に合わせた出題が必要な場合は、学習アプリから成績JSONをエクスポートし、新チャットで渡してください。

## 安全なデータの分離

| データ | 格納先 | 公開範囲 |
|---|---|---|
| 問題・正答・解説 | `catalog/*.json` と公開HTML | GitHub Pagesで公開 |
| 問題別品質監査記録 | `audits/*.json` | 公開GitHubリポジトリ上で閲覧可能（サイト配信はしない） |
| 成績・解答日時・初見区分 | ブラウザ内 `localStorage`（キー：`ipa-system-unified-study-v1`） | 自分のブラウザ領域 |
| 成績JSONバックアップ | 自分のPC等で保管 | 自分が管理。GitHubへコミット禁止 |
| QAレポート・テスト用サンプル | `tests/` またはローカル | 公開サイトには配信しない |

## ファイルの役割

- `index.html`：公開する単一HTML。初期15問は内蔵済み。
- `app.js` / `style.css` / `build_html.py`：HTML再生成用。**ビルドしてもmanifestを初期化しない。**
- `catalog/manifest.json`：配信する問題集の一覧。新問題は末尾へ追記。
- `catalog/2026-11-22-quality15.json`：初期15問の原本。
- `catalog/legacy_v2_metadata.json`：旧95問成績移行に必要な匿名メタデータ。HTML内にも埋め込み済み。
- `audits/*.json`：各問題集の品質監査記録（内部自己監査であることを明記）。
- `tools/verify_catalog.py`：構造・監査証跡・ID重複・標準ダイアログ呼出しの自動検査。
- `tools/register_bank.py`：新規問題集と監査JSONをセットで追記。既定はドライラン。
- `tools/build_site.py`：Pages用の公開ファイルだけを`dist/`に生成。
- `.github/workflows/pages.yml`：自動検証後のデプロイ。
- `tests/test_common_app.py`：Playwrightによる採点等の回帰テスト。
- `SCHEMA.md`：問題・成績JSONの形式。

## 品質・互換性・制約

- 問題品質の正本：`IPA_SYSTEM_QUESTION_QUALITY_STANDARD_v1_1.md`。
- HTML出荷ゲート：`IPA_SYSTEM_HTML_APP_RELEASE_GUARD_v1.md`。`alert/confirm/prompt`に依存しないこと。
- 旧95問v2、旧15問、共通アプリの成績JSONを取り込める。問題集別の初見と再演習の履歴を保持し、履歴を上書きしない。
- 公開問題JSONからは採点前でも技術的に正解を閲覧できる。アプリ画面は提出前には表示しないが、不正閲覧を防ぐ試験配信方式ではない。
- この実行環境でのテストは、HTMLをChromiumのDOMへ直接読み込んだ検証と、ローカルスクリプトによる構造検査。**実際のGitHub Pages公開、公開HTTP読込、ブラウザ再起動後のネイティブ保存永続性は未確認**。


## Step 3: クラウド成績同期（Google Sheets / OAuth）

GitHub Pagesの公開アプリ左メニュー「クラウド成績同期」から設定。
現状はGoogle OAuthクライアントIDをユーザーが用意する初期設定が必要。
詳細は `CLOUD_SYNC_SETUP.md` を参照。

- Google Identity Services のポップアップ認証、`drive.file` 権限（非機密・他のGoogle Driveファイルには原則アクセスしない）
- ユーザーのGoogleアカウントに**非公開**の成績スプレッドシート `IPA_SYSTEM_PRIVATE_LEARNING_RECORDS_v1` を新規作成
- 同期は問題・採点セットIDで重複排除する追記専用ログ。古い行の書き換え・削除を行わない
- 既存の `ipa-system-unified-study-v1` のlocalStorageと成績JSON入出力を保持
- OAuthアクセストークンはメモリだけ。利用設定（Client IDとSheet ID）だけを `ipa-system-cloud-settings-v1` に保存
- 接続中は採点後に同期を試行。ページを再起動した後は「Googleで接続して同期」を再実行する必要がある
- Googleでの実認証やネットワークを経由した同期はGitHub Actionsでは試せない。Google APIモック12ケースと従来の28ケースをCIで実施
- ChatGPT新チャットの成績参照には同じGoogleアカウントのGoogle Driveコネクタと対象シートへのアクセスが別途必要

**Google Sheetsの成績データは非公開のままとし、public GitHubへ学習履歴やトークンをコミットしない。**
