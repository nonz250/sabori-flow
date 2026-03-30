# CLAUDE.md

## プロジェクト概要

Python スクリプトと Claude Code CLI を使って GitHub Issue を自動的に検出し、定期的に対象 Issue を解決するワーカー。
ローカルマシンの launchd / cron で 1 時間ごとに定期実行される。

## リポジトリ情報

- リポジトリ: `nonz250/claude-issue-worker`
- メインブランチ: `main`

## 技術スタック

- Python 3.x（ワーカー本体）
- Claude Code CLI（Issue 解決エンジン。`claude -p` で非対話実行）
- GitHub CLI (`gh`)（Issue 取得・PR 作成・ラベル操作）
- YAML（設定ファイル `config.yml`）
- launchd / cron（スケジューリング）

## アーキテクチャ

### 責務分担

- **Python スクリプト**: Issue 取得、ラベル遷移、優先度ソート、ログ出力、Claude Code CLI の呼び出し
- **Claude Code CLI**: Issue の解決（方針策定・実装）。Python から `claude -p "プロンプト"` で非対話的に呼び出す
- **launchd / cron**: 定期実行のスケジューリング

### 処理フロー

1. `config.yml` から対象リポジトリ一覧を読み込む
2. **plan フェーズ**: `claude/plan` ラベル付き Issue を取得し、Claude Code CLI で方針策定
3. **impl フェーズ**: `claude/impl` ラベル付き Issue を取得し、Claude Code CLI で実装
4. 各フェーズでラベル遷移とコメント投稿を Python が管理する

### ラベル遷移

- plan: `claude/plan` → `claude/plan:in-progress` → `claude/plan:done` / `claude/plan:failed`
- impl: `claude/impl` → `claude/impl:in-progress` → `claude/impl:done` / `claude/impl:failed`

### 並列実行

- `config.yml` の `execution.max_parallel` で制御
- デフォルトは 1（逐次実行）

## コーディング規約

- Python コードは型ヒントを使用する
- エラーハンドリングを適切に行い、失敗時はログを残す
- 機密情報（トークン等）はスクリプトにハードコードしない
- 設定値はすべて `config.yml` で管理する
- `gh` コマンドの実行は `subprocess` 経由で行い、エラー時は標準エラー出力をログに記録する
