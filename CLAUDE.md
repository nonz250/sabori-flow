# CLAUDE.md

## プロジェクト概要

Claude Code を使って GitHub Issue を自動的に検出し、定期的に対象 Issue を解決するワーカースクリプト。
Desktop scheduled tasks によりローカルマシン上で 1 時間ごとに定期実行される。

## リポジトリ情報

- リポジトリ: `nonz250/claude-issue-worker`
- メインブランチ: `main`

## 技術スタック

- Python（ワーカー本体）
- Claude Code CLI（Issue 解決エンジン）
- GitHub CLI (`gh`)（Issue 取得・PR 作成・ラベル操作）
- YAML（設定ファイル `config.yml`）

## アーキテクチャ

### 実行基盤

Claude Code Desktop scheduled tasks（1 時間間隔）でローカルマシン上で定期実行。
デスクトップアプリの起動が前提。

### 処理フロー

1. `config.yml` から対象リポジトリ一覧を読み込む
2. 各リポジトリで `claude-auto` ラベル付き Open Issue を取得
3. `priority:high` → `priority:low` → ラベルなし の順でソート
4. Issue のラベルを `claude-in-progress` に遷移
5. Claude Code を使って Issue を解決
6. 成功時: Draft PR を作成し、ラベルを `claude-done` に遷移
7. 失敗時: Issue にコメントを残し、ラベルを `claude-failed` に遷移

### ラベル遷移

- `claude-auto` → `claude-in-progress` → `claude-done` / `claude-failed`

### 並列実行

- `config.yml` の `execution.max_parallel` で制御
- デフォルトは 1（逐次実行）

## コーディング規約

- Python コードは型ヒントを使用する
- エラーハンドリングを適切に行い、失敗時はログを残す
- 機密情報（トークン等）はスクリプトにハードコードしない
- 設定値はすべて `config.yml` で管理する
