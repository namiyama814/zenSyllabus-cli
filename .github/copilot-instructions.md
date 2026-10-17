# レビュー方針

レビューコメントは日本語で書いてください。動作の不具合、認証の欠陥、データの誤解釈、既存機能の回帰を優先し、指摘には発生条件と影響を添えてください。

## このリポジトリ

- `packages/core` はCLIとWorkersで共有するTypeScriptライブラリです。標準fetchを使用し、Node.js専用APIに依存させません。
- `packages/cli` は日本語表示とJSON出力を提供します。正常な結果はstdout、エラーはstderrへ出します。終了コードは成功0、取得失敗1、入力エラー2です。
- `packages/worker` はStreamable HTTPのMCPとGitHub OAuthを提供します。
- シラバスは `https://api.syllabus.zen.ac.jp/search` からJSONで取得します。HTML解析やブラウザ操作へのフォールバックは設けません。

## 特に確認する点

- APIのリクエストは1始まり、レスポンスのpageは0始まりです。公開インターフェースは1始まりに統一します。
- 科目の識別には年度と科目番号の両方が必要です。「学生便覧を参照」「順次公開予定」は前提科目の確定情報として扱いません。
- OAuthではPKCE S256、stateとブラウザセッションの結び付け、数値GitHubユーザーIDによる本人確認を維持します。認証設定が欠けた場合はアクセスを拒否します。
- MCPリクエストでも許可ユーザーとスコープを確認します。トークン、認可コード、Cookie、Client Secretをログやリポジトリに残しません。
- 自動テストは外部APIをモックします。検証コマンドは `npm run check`、実APIへの疎通確認は `npm run smoke` です。
