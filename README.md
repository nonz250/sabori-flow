# claude-issue-worker

Claude Code を使って GitHub Issue を自動的に検出し、定期的に対象 Issue を解決するワーカースクリプト。

## 概要

このリポジトリは、GitHub リポジトリに登録された Issue を定期的にポーリングし、Claude Code を活用して自動的に解決（コード修正・Draft PR 作成）する仕組みを提供します。

### 主な機能

- 複数リポジトリの GitHub Issue を定期的に検出・取得
- ラベル（`claude-auto`）と優先度（`priority:high` / `priority:low`）による対象 Issue の選定
- Claude Code による Issue の自動解決と Draft PR 作成
- ラベル遷移による処理状態の管理
- 解決失敗時の Issue コメントによるフィードバック

## アーキテクチャ

### 実行基盤

Claude Code デスクトップアプリの [Desktop scheduled tasks](https://docs.anthropic.com/en/docs/claude-code) を利用して 1 時間ごとにローカルマシン上で定期実行します。

### 処理フロー

```
[Desktop scheduled tasks] ─(1時間ごと)─> [ワーカースクリプト]
                                           │
                                           ├─ 1. 設定ファイル（YAML）から対象リポジトリ一覧を取得
                                           ├─ 2. 各リポジトリの `claude-auto` ラベル付き Issue を取得
                                           ├─ 3. 優先度ラベルでソート
                                           ├─ 4. ラベルを `claude-in-progress` に遷移
                                           ├─ 5. Claude Code で Issue を解決
                                           ├─ 6a. 成功 → Draft PR 作成 + `claude-done` ラベル
                                           └─ 6b. 失敗 → Issue にコメント + `claude-failed` ラベル
```

### ラベル遷移

```
claude-auto → claude-in-progress → claude-done
                                 → claude-failed
```

| ラベル | 状態 |
|--------|------|
| `claude-auto` | 自動解決の対象（人間が付与） |
| `claude-in-progress` | 処理中 |
| `claude-done` | 解決済み（Draft PR 作成済み） |
| `claude-failed` | 解決失敗（Issue にコメント済み） |

## 設定ファイル

`config.yml` で対象リポジトリと実行設定を管理します。

```yaml
# 対象リポジトリ
repositories:
  - owner: nonz250
    repo: example-app
    labels:
      trigger: claude-auto
      in_progress: claude-in-progress
      done: claude-done
      failed: claude-failed
    priority_labels:
      - priority:high
      - priority:low

# 実行設定
execution:
  max_parallel: 1
```

## 前提条件

- [Claude Code デスクトップアプリ](https://docs.anthropic.com/en/docs/claude-code) がインストール済みであること
- Claude Code Max プランのサブスクリプション
- GitHub CLI (`gh`) がインストール・認証済みであること
- Python 3.x
- 対象リポジトリへの書き込み権限があること

## セットアップ

```bash
git clone git@github.com:nonz250/claude-issue-worker.git
cd claude-issue-worker
```

### Desktop scheduled tasks の設定

1. Claude Code デスクトップアプリを起動
2. Code タブ → Schedule ページを開く
3. 「New local task」を作成
4. プロンプト・頻度（Hourly）・権限を設定
5. 作業ディレクトリとしてこのリポジトリのパスを指定

## ライセンス

MIT
