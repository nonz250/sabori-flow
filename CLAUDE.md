# CLAUDE.md

## プロジェクト概要

TypeScript (Node.js) と CLI エンジン（Claude Code CLI / GitHub Copilot CLI）を使って GitHub Issue を自動的に検出し、定期的に対象 Issue を解決するワーカー。
npm パッケージとして公開されており、`npx sabori-flow` で利用可能。
ローカルマシンの launchd で 1 時間ごとに定期実行される。

## リポジトリ情報

- リポジトリ: `nonz250/sabori-flow`
- メインブランチ: `main`

## 技術スタック

- TypeScript / Node.js（ワーカー本体 + CLI、npm パッケージとして配布）
- Claude Code CLI / GitHub Copilot CLI（Issue 解決エンジン。`claude -p` または `copilot -p` で非対話実行、`execution.engine` で選択、`execution.autonomy` 設定に応じてフラグを付与）
- GitHub CLI (`gh`)（Issue 取得・PR 作成・ラベル操作・コメント投稿）
- yaml（設定ファイル `config.yml` の読み込み）
- vitest（テストフレームワーク）
- launchd（macOS スケジューリング）

## アーキテクチャ

### 責務分担

- **TypeScript ワーカー** (`src/worker/`): Issue 取得、ラベル遷移、優先度ソート、プロンプト生成、CLI エンジンの呼び出し、結果判定、コメント投稿、ログ出力
- **CLI エンジン** (Claude Code CLI / GitHub Copilot CLI): Issue の解決（方針策定・実装）。Node.js から stdin 経由でプロンプトを渡して非対話実行。`config.yml` の `execution.engine` で選択
- **TypeScript CLI** (`src/commands/`): 対話的セットアップ（config.yml 生成、launchd 登録・解除）
- **launchd**: `npx sabori-flow worker` を定期実行（デフォルト）。`--local` 時は `node dist/worker.js` を直接実行

### TypeScript モジュール構成

```
src/
  index.ts          # CLI エントリポイント
  worker.ts         # ワーカーエントリポイント
  commands/          # CLI コマンド
    init.ts, install.ts, uninstall.ts, add.ts
    helpers/
      repository-prompt.ts  # 対話入力の共通ロジック（init/add で共有）
  worker/            # ワーカー本体
    main.ts          # メインロジック、並列実行制御
    config.ts        # config.yml 読み込み・バリデーション
    models.ts        # データモデル（interface, enum）
    fetcher.ts       # gh issue list で Issue 取得・優先度ソート
    pipeline.ts      # 1 Issue の処理パイプライン（DI パターン）
    prompt.ts        # プロンプトテンプレート読み込み・展開
    executor.ts      # CLI エンジン実行（Claude / Copilot）
    worktree.ts      # git worktree ライフサイクル管理
    label.ts         # ラベル遷移操作
    comment.ts       # Issue コメント投稿
    logger.ts        # 軽量ロガー
    process.ts       # child_process ラッパー
  utils/             # 共有ユーティリティ
    paths.ts         # ~/.sabori-flow/ ベースのパス解決 + expandTilde（チルダ展開）
    plist.ts, shell.ts, config-defaults.ts
```

### 処理フロー

1. `config.yml` から対象リポジトリ一覧を読み込む
2. リポジトリ単位で `Promise.all` により並列実行
3. 各リポジトリで plan → impl の順にフェーズを処理
4. 各 Issue に対して以下のパイプラインを実行:
   - ラベル遷移: trigger → in-progress
   - git worktree 作成（対象リポジトリの local_path から）
   - プロンプト生成（テンプレート + Issue 情報）
   - CLI エンジン（`claude -p` / `copilot -p`）を worktree 内で実行（`execution.engine` で選択、`execution.autonomy` に応じてフラグを付与）
   - 成功: `sanitizeOutput` でシークレットマスキング後、done ラベル + 成功コメント / 失敗: failed ラベル + 失敗コメント
   - worktree 削除（finally）

### ラベル遷移

- plan: `claude/plan` → `claude/plan:in-progress` → `claude/plan:done` / `claude/plan:failed`
- impl: `claude/impl` → `claude/impl:in-progress` → `claude/impl:done` / `claude/impl:failed`

### エラーハンドリング 3 段階

- **レベル 1**: trigger→in-progress 失敗 → 即中断、次回リトライ可能
- **レベル 2**: プロンプト生成/CLI 実行失敗 → failed 遷移 + 失敗コメント
- **レベル 3**: 後処理（done/failed ラベル遷移、コメント投稿）失敗 → ログ WARNING のみ

### 並列実行

- `config.yml` の `execution.max_parallel`（1-10）で制御
- `config.yml` の `execution.max_issues_per_repo`（1-20）でリポジトリあたりの最大処理数を制御
- `Promise.all` で repo 単位の並列実行
- 同一リポジトリ内の Issue は逐次処理

### セキュリティ

#### プロンプト保護
- `String.replace(() => value)` の関数ラッパーによるプレースホルダ展開（特殊パターン解釈を回避）
- ユーザー入力由来の変数（issue_body, issue_title）を最後に展開（二重展開防止）
- UUID ベースのランダムバウンダリでデータ境界を明示（予測不能なトークンによるプロンプトインジェクション対策）
- Issue 作成者の権限チェック（OWNER / MEMBER / COLLABORATOR のみ処理対象）
- テンプレートファイルのサイズ上限（100KB）、レギュラーファイル判定

#### 出力保護
- `sanitizeOutput` による成功コメントのシークレットマスキング（AWS キー、GitHub トークン、SSH 秘密鍵、Bearer トークン等）
- エラーメッセージのサニタイズ（内部パス情報を Issue コメントに含めない）

#### プロセス・ファイル保護
- 全 `child_process.execFile` / `spawn` に shell 非経由 + タイムアウト設定
- plist 生成時の XML エスケープ
- `which npx/node` 結果のバリデーション（絶対パス検証）
- launchd に埋め込む PATH の最小化（必要コマンドの所在 + 標準パスのみ）
- plist ファイルのパーミッション（0o600）
- config.yml のパーミッション（0o600）
- テンプレートコピー時のパーミッション設定（コピー先ファイル: 0o600、ディレクトリ: 0o700）
- `local_path` の `realpathSync` による実パス解決
- YAML パースの `maxAliasCount` 制限（エイリアス爆弾対策）
- ログローテーションのシンボリックリンクチェック
- `--local` フラグによるサプライチェーンリスク軽減（npx 経由を回避し、ローカルビルドを直接実行）

### テスト

- フレームワーク: vitest
- テストディレクトリ: `tests/worker/`, `tests/commands/`, `tests/utils/`
- ヘルパー:
  - `tests/worker/helpers/factories.ts`: テスト用ファクトリ（`makeIssue()`, `makeRepoConfig()` など）
  - `tests/worker/helpers/mock-deps.ts`: DI 用モック生成（`createMockPipelineDeps()`, `createMockWorkerDeps()`）
- 方針: 依存性注入 + vitest の `vi.fn()` によるモックベースの単体テスト
- カバレッジ除外: `src/index.ts`, `src/worker.ts`（エントリポイント）

### npm スクリプト

| コマンド | 説明 |
|---|---|
| `npm run build` | TypeScript コンパイル（`tsc` → `dist/`） |
| `npm run worker` | ビルド済みワーカー実行（`node dist/worker.js`） |
| `npm run dev:worker` | `tsx` で開発実行（ビルド不要） |
| `npm test` | テスト実行 |
| `npm run test:watch` | ウォッチモード |
| `npm run test:coverage` | カバレッジ計測 |
| `npm run prepublishOnly` | ビルド（`npm publish` 前に自動実行） |

### パス管理

全ユーザーデータを `~/.sabori-flow/` に集約する。

| 用途 | パス |
|---|---|
| 設定ファイル | `~/.sabori-flow/config.yml` |
| プロンプトテンプレート | `~/.sabori-flow/prompts/` |
| ログ | `~/.sabori-flow/logs/` |
| plist バックアップ | `~/.sabori-flow/com.github.sabori-flow.plist` |

### プロンプトテンプレート

パッケージ同梱テンプレートは `prompts/{lang}/` に言語別で配置される。`init` コマンド実行時に選択言語のテンプレートが `~/.sabori-flow/prompts/` にコピーされ、ユーザーが自由にカスタマイズ可能。

テンプレート読み込みの優先順位（2 層フォールバック）:

1. `~/.sabori-flow/prompts/`（ユーザー共通、init 時にコピー）
2. パッケージ同梱 `prompts/{lang}/`（フォールバック）


### config.yml の設定項目

- `repositories`: 対象リポジトリ一覧（必須、1 件以上）
- `execution.engine`: 実行エンジン（`claude` / `copilot`、デフォルト: `claude`）
- `execution.max_parallel`: 並列実行数（整数、1-10、デフォルト: 1）
- `execution.max_issues_per_repo`: リポジトリあたりの最大処理 Issue 数（整数、1-20、デフォルト: 1）
- `execution.autonomy`: CLI の自律実行レベル（`full` / `sandboxed` / `interactive`、デフォルト: `interactive`）
- `execution.interval_minutes`: スケジュール実行間隔（整数、10-1440分、デフォルト: 60）
- `language`: CLI メッセージおよびプロンプトテンプレートの言語（`ja` / `en`、デフォルト: `ja`）

## コーディング規約

- TypeScript の strict モードを使用する
- エラーハンドリングを適切に行い、失敗時はログを残す
- 機密情報（トークン等）はスクリプトにハードコードしない
- 設定値はすべて `config.yml` で管理する
- `gh` / `git` コマンドの実行は `child_process` 経由、shell 非経由、タイムアウト付きで行う
- プロンプトテンプレートは `prompts/` ディレクトリの Markdown ファイルで管理する
- GitHub 上で扱う言語（Issue、PR、コミットメッセージ、コードコメント、README 等）はすべて英語で記述する
