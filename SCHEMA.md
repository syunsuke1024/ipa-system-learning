# IPA システム領域：問題集・成績スキーマ v1

## 新規の問題集JSON

最上位オブジェクトは、`bank_version`（**全問題集で新規の識別子**）、`questions`（1〜500問）を持ちます。`display_name`、`source_notice`、`audit_status` は任意です。

各 `questions[]` に以下の項目が必要です。

| 項目 | 形式・意味 |
|---|---|
| `question_id` | 問題ID。1問題集内で一意。再利用・無断の変更は禁止 |
| `question_version` | 問題版（例 `1.0.0`） |
| `section` | `A1`、`A2`、`B` のいずれか |
| `major` / `minor` | 大分類・小分類 |
| `difficulty` | 基礎・標準・応用など |
| `stem` | 問題文 |
| `case` | 任意の業務事例本文 |
| `options` | 4選択肢の文字列配列 |
| `answer` | `A`、`B`、`C`、`D` のどれか |
| `why` | 正答根拠の固有解説 |
| `optionNotes` | 4選択肢の個別評価（4要素の文字列配列） |
| `depth` | 技術的背景の固有解説 |
| `application` | 実務応用・障害・判断の固有解説 |

実際の完成した例は `catalog/2026-11-22-quality15.json` を参照してください。

問題集を同じ `bank_version` で上書きすると履歴の対応が崩れるため、内容変更は**別の `bank_version`** として登録します。アプリは既存版と異なる内容を受け付けません。

## 公開カタログJSON

`catalog/manifest.json` に `schema_version: "ipa-study-catalog-manifest-v1"` と `banks: [{"file": "catalog/<file>.json", "bank_version": "...", "audit_status": "..."}]` を指定します。ファイルパスはリポジトリルート相対です。公開カタログはHTTP/HTTPS配信時に読まれ、ローカルfile起動では自動読込しません。

## 成績JSON

エクスポートの `schema_version` は `ipa-unified-study-1`。`banks`、`records`、`attempts`、`schedule` などが入ります。

`records[]` は次の情報を1問単位で持ちます。

`record_id`, `attempt_id`, `bank_version`, `question_id`, `question_version`, `section`, `major`, `minor`, `difficulty`, `answer`, `correct`, `unknown`, `mode`, `is_first_seen`, `answered_at`, `submitted_at`, `answer_date`, `elapsed_seconds`

- `answer` の `?` は「わからない」であり、`unknown:true,correct:false` です。
- `is_first_seen` は同じ問題集・問題ID・問題版の初回解答ならtrueです。
- `attempts[]` は科目別のセット提出結果を表します。
- 同じ `record_id` の重複は除外します。成績本文が異なる場合は取込みを拒否します。
- 同じ問題集の答案や正答をHTML側から参照できるため、公開問題集の正答は技術的には閲覧可能です。UIには採点前表示しません。
- 学習記録には個人の学習履歴が含まれます。公開GitHubリポジトリへ記録JSONをアップロードしないでください。

## 旧データとの互換性

- `ipa-study-records-1`：旧15問アプリの成績バックアップ。`records` と `attempts` を維持し、既存の重複を除外。
- `ipa-pds-95-revised-v2`：旧95問v2の`state`ラッパーを含むJSON。採点済みセットを旧メタデータに照らして成績に変換。問題集そのものは自動で演習登録しません。
- 記録元が別オリジン／端末の場合は、ユーザーがJSONをエクスポートして新アプリへインポートする必要があります。


## Google Sheetsクラウド成績ログ v1

Googleユーザーがブラウザから初回接続時に作成する非公開の台帳（他の全Google Sheetsへのアクセスではなく `drive.file` OAuth）。

- `Config!A1:B1` = `schema_version` / `ipa-study-cloud-log-v1`。異なる台帳への誤書込みを防ぐ。
- `LearningLog!A1:T1` = `kind,id,attempt_id,bank_version,question_id,question_version,section,major,minor,difficulty,answer,correct,unknown,mode,is_first_seen,answered_at,submitted_at,answer_date,elapsed_seconds,payload_json`。
- `kind=RECORD`：各問題別の変更不能な記録を1行で保存。末尾 `payload_json` は成績JSONと同一の完全レコード。
- `kind=ATTEMPT`：科目別セット採点履歴を1行で保存。末尾JSONに`total`/`correct`/`unknown`等が入る。
- Google Sheets API `values.append` / `RAW` / `INSERT_ROWS` で未同期行のみ追記。同期時には全件を再取得しID重複を除外。重複IDの不整合を検出したら同期中断。
- ローカル `localStorage` のキー `ipa-system-unified-study-v1` は維持。Client IDとSheet IDは別の設定キーに保存し、アクセストークンは永続化しない。
- Google Sheetsの共有権限は所有者の設定に従う。Google認証に成功しても閲覧権限が無いシートへは同期しない。

備考：複数端末で同時に同じ記録IDを送った場合、クラウド台帳に重複行が発生する可能性がある（読込み時に同一内容を重複排除）。同一IDの内容が異なればエラーとする。
