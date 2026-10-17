# zen-syllabus

ZEN大学の公開シラバスを検索するCLIと、Cloudflare Workers向けMCPサーバーです。検索、科目詳細、条件絞り込み、2〜5科目の比較、前提・後継科目の確認に対応します。

データは利用時に `https://api.syllabus.zen.ac.jp/search` からJSONで取得します。HTML解析やブラウザ操作は使いません。CLIは認証不要、MCPはGitHub OAuthで指定した本人だけが利用できます。

## CLIを使う

Node.js 24以上とnpmが必要です。

```sh
npm ci
npm run build
npm exec -- zen-syllabus search プログラミング --year 2026
npm exec -- zen-syllabus show INF-1-C1-1030-002 --year 2026
npm exec -- zen-syllabus compare INF-1-C1-1030-002 INF-1-C1-0204-003 --year 2026
npm exec -- zen-syllabus prerequisites INF-1-C1-1030-002 --year 2026
npm exec -- zen-syllabus filters teacher --json
```

直接 `zen-syllabus` を実行したい場合は、ビルド後に `npm link --workspace @zen-syllabus/cli` でコマンドを登録してください。npmへの公開は不要です。

全コマンドで `--json` を指定できます。正常な結果は標準出力、エラーは標準エラーに出します。終了コードは成功が `0`、通信失敗・該当科目なし・比較の一部失敗が `1`、入力エラーが `2` です。比較で一部の取得に失敗した場合も、取得できた科目は出力します。

検索は年度未指定なら全年度が対象です。詳細、比較、前提科目確認では `--year` が必須です。比較対象は同じ年度の科目を指定します。

### 検索条件

```sh
npm exec -- zen-syllabus search --teacher '折原 ダビデ竜' --year 2026
npm exec -- zen-syllabus search --category applied_informatics --quarter 1q --credit 2
npm exec -- zen-syllabus search Python --page 2 --sort subject-desc --json
npm exec -- zen-syllabus search --teacher-id 36 --tag-id 202
npm exec -- zen-syllabus search --pattern-id 26 --requirement elective
```

| オプション | 指定値 |
|---|---|
| `--year` | 開講年度（例 `2026`） |
| `--grade` | 想定年次 `1`〜`4` |
| `--category` | 分類ID。例 `applied_informatics`、`mathematical_sciences` |
| `--tag-id` | タグの数値ID |
| `--teacher` / `--teacher-id` | 教員名、または数値ID。同時指定不可 |
| `--quarter` | `1q`、`2q`、`3q`、`4q`、`1-2q`、`3-4q`、`annual`。大文字の `1Q` なども可 |
| `--method` | `on-demand`、`live-video`、`exercise`、`seminar` |
| `--credit` | `1`、`2`、`4` |
| `--requirement` | `required`、`required-elective`、`elective`、`free` |
| `--pattern-id` | 履修パターンの数値ID |
| `--day` | `monday`、`tuesday`、`wednesday`、`thursday`、`friday`、`intensive` |
| `--page` | 1始まり。通常の検索は指定ページだけを取得 |
| `--sort` | `subject-asc`（既定）、`subject-desc` |

`filters [kind]` でAPIに存在する候補を確認できます。`kind` は `year`、`grade`、`category`、`tag`、`teacher`、`quarter`、`method`、`credit`、`requirement`、`pattern`、`day` です。省略すると全種類を表示します。

`filters` は全科目をページ単位で取得して候補を集計します。`kind` を指定しても全ページを取得します。2026年10月の確認時点では15ページです。教員名の解決でも候補の検索結果をページ単位で取得します。候補が複数なら名前とIDを返すため、`--teacher-id` で選択してください。履修パターンはAPIに名称がないため、IDで表示します。

## MCPをローカルで起動する

[GitHub OAuth App](https://github.com/settings/developers)をローカル用に1つ作成します。

- Homepage URL `http://localhost:8787`
- Authorization callback URL `http://localhost:8787/callback`

```sh
cp packages/worker/.dev.vars.example packages/worker/.dev.vars
```

`.dev.vars` に以下を設定します。このファイルはGit管理から除外しています。

```dotenv
GITHUB_CLIENT_ID=ローカル用OAuth_AppのClient_ID
GITHUB_CLIENT_SECRET=ローカル用OAuth_AppのClient_Secret
ALLOWED_GITHUB_USER_ID=本人のGitHub数値ユーザーID
PUBLIC_ORIGIN=http://localhost:8787
```

数値ユーザーIDは `https://api.github.com/users/<GitHubユーザー名>` の `id` で確認できます。ユーザー名ではなく数値を指定してください。

```sh
npm run dev
```

MCP接続先は `http://localhost:8787/mcp`、ヘルスチェックは `http://localhost:8787/health` です。OAuth対応のMCPクライアント、またはMCP InspectorでStreamable HTTP接続してください。

```sh
npx @modelcontextprotocol/inspector
```

接続時にアプリ名と接続先を確認し、「GitHubで認証して接続」を選びます。GitHubでは `read:user` のみ要求します。許可した数値ユーザーID以外は認証後に拒否します。設定が不足している場合は `/health` を除き503を返します。

## Cloudflare Workersへデプロイする

本番用にはローカル用と別のGitHub OAuth Appを作成します。以下のURLのホストを、自分のWorkers名とサブドメインに置き換えてください。

- Homepage URL `https://zen-syllabus-mcp.<your-subdomain>.workers.dev`
- Authorization callback URL `https://zen-syllabus-mcp.<your-subdomain>.workers.dev/callback`

Cloudflareへログインし、OAuth用KVを作成します。以下の操作は本番リソースを作成するため、デプロイ時に実行してください。

```sh
npm exec -w @zen-syllabus/worker -- wrangler login
npm exec -w @zen-syllabus/worker -- wrangler kv namespace create OAUTH_KV
```

作成したKVのIDを `packages/worker/wrangler.jsonc` の `kv_namespaces[0].id` に設定します。初期値の `00000000000000000000000000000000` はダミーです。同じファイルの `vars` も本番の値へ変更します。

```json
{
  "GITHUB_CLIENT_ID": "本番用OAuth_AppのClient_ID",
  "ALLOWED_GITHUB_USER_ID": "本人のGitHub数値ユーザーID",
  "PUBLIC_ORIGIN": "https://zen-syllabus-mcp.<your-subdomain>.workers.dev"
}
```

`PUBLIC_ORIGIN` は末尾の `/` を付けず、実際の接続URLと一致させます。カスタムドメインを使う場合も、この値とGitHubのコールバックURLを合わせてください。

Client Secretは設定ファイルに書かず、対話入力で登録します。

```sh
npm exec -w @zen-syllabus/worker -- wrangler secret put GITHUB_CLIENT_SECRET
npm run deploy:dry-run
npm run deploy
```

デプロイ後の接続先は `https://zen-syllabus-mcp.<your-subdomain>.workers.dev/mcp` です。ローカルと同様に、OAuth対応クライアントからGitHub認証で接続します。ブラウザで `/mcp` を直接開くと認証要求が返ります。動作確認には `/health` またはMCPクライアントを使ってください。

### MCPツール

| ツール | 主な入力 | 出力 |
|---|---|---|
| `search_subjects` | `query`、`year`、`grade`、`category`、`tagId`、`teacher` / `teacherId`、`quarter`、`method`、`credit`、`requirement`、`patternId`、`day`、`page`、`sort` | 科目概要、件数、ページ情報 |
| `get_subject` | `year`、`numbering` | 授業計画・評価方法・教材などの詳細 |
| `compare_subjects` | `year`、`numberings`（2〜5件） | 入力順の比較結果と対象ごとのエラー |
| `get_subject_relations` | `year`、`numbering` | 推奨・強く推奨の前提科目、推奨後継科目 |
| `list_filter_options` | `kind`（省略可） | 使用中のフィルター候補 |

全ツールは読み取り専用です。CLIと同じ共通ライブラリを使い、テキストと `structuredContent` を返します。

OAuthメタデータ、`/authorize`、`/callback`、`/register`、`/token` を公開します。MCPクライアント向けの認可にはPKCE S256を必須とし、承認画面・GitHubコールバックをブラウザセッションに結び付けています。GitHubトークンは本人確認後に保持しません。KVにはOAuthの状態・認可情報だけを保存します。自動のリクエストログを無効にし、アプリのログにはクエリー文字列や認証情報を含めません。

## 開発と検証

```sh
npm run check           # 型チェック、モックテスト、ビルド、デプロイドライラン
npm run test:unit       # APIクライアントと実プロセスのCLIテスト
npm run test -w @zen-syllabus/worker  # Workers実行環境でのMCP・OAuthテスト
npm run smoke           # 実APIの検索・詳細・比較・前提科目・全ページ取得を確認
npm run types -w @zen-syllabus/worker  # Wrangler設定変更後に型を再生成
```

CIは外部APIをモックします。GitHub認証、コード交換、PKCE、本人以外の拒否、stateの再利用、トークン期限切れ、更新、MCP全ツールの呼び出しをWorkers上でテストします。実際のGitHub OAuth Appを使うブラウザ認証は、環境設定後に確認してください。

| パッケージ | 役割 |
|---|---|
| `packages/core` | 標準fetchを使うAPIクライアント、型、入力検証、比較処理 |
| `packages/cli` | `zen-syllabus`、日本語表示・JSON出力 |
| `packages/worker` | MCP、GitHub OAuth、Wrangler設定 |

## データの扱い

検索APIに年度と科目番号を渡すと、詳細情報もJSONで取得できます。詳細用の独立したAPIは使いません。APIのページ番号は、リクエストが1始まり、レスポンスが0始まりです。CLI・MCPでは1始まりに統一しています。

永続的なシラバスキャッシュはありません。1リクエストのタイムアウトは15秒、一時的な通信失敗・429・一部の5xxは最大2回再試行します。APIの構造が変わった場合はエラーを返し、HTML解析には切り替えません。

「学生便覧を参照」「順次公開予定」は参照情報として扱います。MCPの関係情報では `kind: "reference"`、`sourceUrl: null` を返します。推奨科目を履修必須条件として判定する機能はありません。科目の取得結果には公式ページURLと取得日時を付けています。

本ツールはZEN大学の公式提供物ではありません。サイト内部のAPIを利用しているため、提供側の変更に合わせた修正が必要になる場合があります。履修判断には返却された公式ページも確認してください。

MIT License
