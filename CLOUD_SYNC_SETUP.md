# IPAシステム領域｜Google Sheets成績クラウド同期 セットアップ v1

作成日：2026-11-22。公開HTMLアプリはIPA公式サービスではありません。

## 運用目的と構成

- 公開学習アプリ：`https://syunsuke1024.github.io/ipa-system-learning/`
- クラウド記録：本人のGoogleアカウント内の**非公開Google Sheets**（アプリが新規作成）。公開GitHubリポジトリ・Pagesには成績を登録しない。
- Google認証：OAuth 2.0 / Google Identity Services。アクセストークンはページのメモリだけに保持し、ブラウザ保存領域にもGitHubにも保存しない。
- スコープは `https://www.googleapis.com/auth/drive.file`。アプリが作成・使用するファイルへのアクセスだけを要求する（既存の全Google Drive内容へのアクセス許可は不要）。
- 端末側：元の `ipa-system-unified-study-v1` とJSONエクスポートを継続使用。同期は追加・復元し、既存成績の削除・置換を行わない。

## 初回設定（ユーザーのGoogle Cloud Consoleで一度だけ）

1. Google Cloud Console https://console.cloud.google.com/ で任意の**自分の**プロジェクトを選ぶか新規作成する。料金発生を避けたい場合は、追加の有料機能や課金アカウントを有効にする操作を避ける。
2. `APIs & Services` → `Library` → **Google Sheets API** を探して有効化する。
3. `Google Auth Platform`（OAuth同意画面）でアプリ名、問い合わせメール、対象ユーザーを設定。個人Googleアカウントは通常 `External` を選択し、テストモードなら **Test users** に自分のGoogleアカウントを追加する。
4. `Clients` → `Create client` → **Web application** を選択。
5. `Authorized JavaScript origins` に **`https://syunsuke1024.github.io`** を登録（`/ipa-system-learning` のパスは含めない）。このポップアップ方式ではリダイレクトURIの入力は通常不要。
6. 発行された **Client ID**（形式：`数字-文字列.apps.googleusercontent.com`）を控える。**Client secretは発行されてもHTMLへ登録しない。**
7. ユーザーのChromeで学習アプリを開く → 左メニュー「クラウド成績同期」 → Client IDを貼付 → 初回の成績シートIDは空欄 → **「Googleで接続して同期」**。
8. Googleのポップアップで、Google Driveコネクタと同じGoogleアカウントを選択して許可する。初回はGoogle Sheetsへ私有の成績台帳を作り、ブラウザの既存成績を追記。完了時に `同期成功` を確認する。
9. 「Google Sheetsで開く」を押して、`LearningLog` シートのレコード行と `Config` のスキーマを確認。成績シートは非公開のままにする。

## 2台目のブラウザ、復元、ChatGPTからの参照

- 別のPC/スマートフォン：同じアプリURLで「クラウド成績同期」を開き、同じ **Client ID** と、Google Sheets URLの `/d/<sheet-id>/` にある **Sheet ID** を入力し、Googleで接続して同期する。**既存シートIDを空欄にすると別の台帳が作成されるため注意。**
- 一度接続すると、そのページを開いている間は採点後に自動同期を試す。ページの再読み込み・Google認証の期限切れ後は改めて接続が必要。通信失敗時でも、ブラウザ内の既存の採点・成績JSONのエクスポートは利用できる。
- 新しいChatGPTチャットでは、同一Googleアカウントに接続したGoogle Drive/Sheetsコネクタから、**`IPA_SYSTEM_PRIVATE_LEARNING_RECORDS_v1`** を検索するか、Sheet URLを渡して問題別履歴を参照する。Sheetsの名前は他利用者と衝突し得るため、実際のSheet IDを確認する。
- 完全な自動取込みの検証はGoogle認証実動作を含むため、**まだ未実施**。GitHub ActionsでGoogle Sheets APIをモックしたテストを先に実施する。

## 安全・不具合への対策

- 同期は1問題1レコード、セット採点1レコードの**append-only**。既存行を上書き・削除せず、記録IDで重複排除する。失敗後は再同期してよい。衝突を検知したら書込みを停止する。
- 複数ブラウザで同じ記録を同時に書くと、台帳に内容同一の重複行ができる場合がある。読取り時に重複排除する。別内容の同一IDは障害として報告する。
- 端末でブラウザ保存ができない場合、同期失敗時に履歴が失われる可能性があるため定期的にJSONバックアップを保存する。
- Google Sheets APIの無料枠・レート制限はGoogleアカウントとプロジェクトの設定に依存する。HTTP 403/429等ではアプリ内に原因を表示し、ローカル履歴は保持する。
- OAuthクライアントの作成だけではサイトから実際のGoogle接続が成立することは証明できない。Google Cloud設定・ログイン・初回同期・新チャットでのコネクタ参照は実ユーザー環境での確認が必要。

## 開発テスト

```sh
python tools/verify_catalog.py
python build_html.py
git diff --exit-code -- index.html catalog/manifest.json
python tests/test_common_app.py
python tests/test_cloud_sync.py
python tools/build_site.py
```

`test_common_app.py` は従来採点の28項目、`test_cloud_sync.py` はGoogle認証・Sheets APIをモックする12項目を検証。実Google OAuthやSheets API呼び出しは含まない。
