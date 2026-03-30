# CLAUDE.md

## プロジェクト概要

Claude Code を使って GitHub Issue を自動的に検出し、定期的に対象 Issue を解決するワーカースクリプト。

## リポジトリ情報

- リポジトリ: `nonz250/claude-issue-worker`
- メインブランチ: `main`

## 技術スタック

- シェルスクリプト（ワーカー本体）
- Claude Code CLI（Issue 解決エンジン）
- GitHub CLI (`gh`)（Issue 取得・PR 作成）

## アーキテクチャ

### 処理フロー

1. GitHub API 経由で対象リポジトリの未解決 Issue を取得
2. Issue の内容を解析し、対応可能か判定
3. Claude Code を使って Issue に対する修正を実施
4. 修正内容をブランチに push し、PR を作成

## コーディング規約

- シェルスクリプトは POSIX 互換を意識する
- エラーハンドリングを適切に行い、失敗時はログを残す
- 機密情報（トークン等）はスクリプトにハードコードしない
