# claude-issue-worker

Claude Code を使って GitHub Issue を自動的に検出し、定期的に対象 Issue を解決するワーカースクリプト。

## 概要

このリポジトリは、GitHub リポジトリに登録された Issue を定期的にポーリングし、Claude Code を活用して自動的に解決（コード修正・PR 作成）する仕組みを提供します。

### 主な機能

- GitHub Issue の定期的な検出・取得
- Issue の内容を解析し、Claude Code による自動解決
- 解決結果を PR として自動作成

## 前提条件

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) がインストール済みであること
- GitHub CLI (`gh`) がインストール・認証済みであること
- 対象リポジトリへの書き込み権限があること

## セットアップ

```bash
git clone git@github.com:nonz250/claude-issue-worker.git
cd claude-issue-worker
```

## ライセンス

MIT
