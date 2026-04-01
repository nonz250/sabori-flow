# CLAUDE.md

## プロジェクト概要

Python スクリプトと Claude Code CLI を使って GitHub Issue を自動的に検出し、定期的に対象 Issue を解決するワーカー。
ローカルマシンの launchd で 1 時間ごとに定期実行される。

## リポジトリ情報

- リポジトリ: `nonz250/claude-issue-worker`
- メインブランチ: `main`

## 技術スタック

- Python 3.x（ワーカー本体）
- TypeScript / Node.js（セットアップ CLI）
- Claude Code CLI（Issue 解決エンジン。`claude -p --dangerously-skip-permissions` で非対話実行）
- GitHub CLI (`gh`)（Issue 取得・PR 作成・ラベル操作・コメント投稿）
- YAML（設定ファイル `config.yml`）
- launchd（macOS スケジューリング）

## アーキテクチャ

### 責務分担

- **Python ワーカー** (`src/`): Issue 取得、ラベル遷移、優先度ソート、プロンプト生成、Claude Code CLI の呼び出し、結果判定、コメント投稿、ログ出力
- **Claude Code CLI**: Issue の解決（方針策定・実装）。Python から stdin 経由でプロンプトを渡して非対話実行
- **TypeScript CLI** (`cli/`): 対話的セットアップ（config.yml 生成、venv 構築、launchd 登録・解除）
- **launchd**: 定期実行のスケジューリング

### Python モジュール構成

```
src/
  main.py         # エントリポイント、ログ設定、並列実行制御
  config.py       # config.yml 読み込み・バリデーション
  models.py       # データモデル（Issue, Phase, RepositoryConfig 等）
  fetcher.py      # gh issue list で Issue 取得・優先度ソート
  prompt.py       # プロンプトテンプレート読み込み・プレースホルダ展開
  pipeline.py     # 1 Issue の処理パイプライン（ラベル遷移→実行→結果判定）
  worktree.py     # git worktree のライフサイクル管理（コンテキストマネージャ）
  executor.py     # claude -p の実行（stdin 経由、タイムアウト付き）
  label.py        # gh issue edit でラベル追加・削除
  comment.py      # gh issue comment で結果コメント投稿
```

### 処理フロー

1. `config.yml` から対象リポジトリ一覧を読み込む
2. リポジトリ単位で `ThreadPoolExecutor` により並列実行
3. 各リポジトリで plan → impl の順にフェーズを処理
4. 各 Issue に対して以下のパイプラインを実行:
   - ラベル遷移: trigger → in-progress
   - git worktree 作成（対象リポジトリの local_path から）
   - プロンプト生成（テンプレート + Issue 情報）
   - `claude -p --dangerously-skip-permissions` を worktree 内で実行
   - 成功: done ラベル + 成功コメント / 失敗: failed ラベル + 失敗コメント
   - worktree 削除（finally）

### ラベル遷移

- plan: `claude/plan` → `claude/plan:in-progress` → `claude/plan:done` / `claude/plan:failed`
- impl: `claude/impl` → `claude/impl:in-progress` → `claude/impl:done` / `claude/impl:failed`

### エラーハンドリング 3 段階

- **レベル 1**: trigger→in-progress 失敗 → 即中断、次回リトライ可能
- **レベル 2**: プロンプト生成/CLI 実行失敗 → failed 遷移 + 失敗コメント
- **レベル 3**: 後処理（done/failed ラベル遷移、コメント投稿）失敗 → ログ WARNING のみ

### 並列実行

- `config.yml` の `execution.max_parallel` で制御
- `ThreadPoolExecutor` で repo 単位の並列実行
- 同一リポジトリ内の Issue は逐次処理

### セキュリティ

- `str.replace()` によるプレースホルダ展開（`str.format_map()` の属性アクセスリスクを回避）
- ユーザー入力由来の変数（issue_body, issue_title）を最後に展開（二重展開防止）
- `<issue-body>` タグでプロンプトインジェクション対策（データ境界の明示）
- エラーメッセージのサニタイズ（内部パス情報を Issue コメントに含めない）
- 全 `subprocess.run` に `shell=False` + タイムアウト設定

## コーディング規約

- Python コードは型ヒントを使用する
- エラーハンドリングを適切に行い、失敗時はログを残す
- 機密情報（トークン等）はスクリプトにハードコードしない
- 設定値はすべて `config.yml` で管理する
- `gh` / `git` コマンドの実行は `subprocess` 経由、`shell=False`、タイムアウト付きで行う
- プロンプトテンプレートは `prompts/` ディレクトリの Markdown ファイルで管理する
