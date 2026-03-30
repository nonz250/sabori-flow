# claude-issue-worker

Claude Code Desktop scheduled tasks を使って GitHub Issue を自動的に検出し、定期的に対象 Issue を解決する仕組み。

## 概要

Claude Code デスクトップアプリの定期実行機能により、GitHub リポジトリの Issue をポーリングし、Claude Code が自律的に解決（コード修正・Draft PR 作成）します。

スクリプトは不要です。Claude Code が `CLAUDE.md` の指示と `config.yml` の設定に基づいて `gh` コマンドで直接操作します。

### リポジトリ構成

```
claude-issue-worker/
├── CLAUDE.md        # Claude Code への処理指示（ロジック本体）
├── config.yml       # 対象リポジトリ・ラベル・実行設定
└── README.md        # ドキュメント
```

### 主な機能

- 複数リポジトリの GitHub Issue を定期的に検出・取得
- ラベル（`claude-auto`）と優先度（`priority:high` / `priority:low`）による対象 Issue の選定
- Claude Code による Issue の自動解決と Draft PR 作成
- ラベル遷移による処理状態の管理
- 解決失敗時の Issue コメントによるフィードバック

## アーキテクチャ

### 実行基盤

Claude Code デスクトップアプリの Desktop scheduled tasks を利用して 1 時間ごとにローカルマシン上で定期実行します。

### 処理フロー

```
[Desktop scheduled tasks] ─(1時間ごと)─> [Claude Code]
                                           │
                                           ├─ CLAUDE.md を読み込み
                                           ├─ config.yml から対象リポジトリ一覧を取得
                                           │
                                           ├─ 各リポジトリに対して:
                                           │   ├─ gh issue list で claude-auto ラベル付き Issue を取得
                                           │   ├─ 優先度ラベルでソート
                                           │   ├─ ラベルを claude-in-progress に遷移
                                           │   ├─ 対象リポジトリをクローンし Issue を解決
                                           │   ├─ 成功 → Draft PR 作成 + claude-done ラベル
                                           │   └─ 失敗 → Issue にコメント + claude-failed ラベル
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
- 対象リポジトリへの書き込み権限があること

## セットアップ

```bash
git clone git@github.com:nonz250/claude-issue-worker.git
cd claude-issue-worker
cp config.yml.example config.yml  # 設定ファイルを作成し、対象リポジトリを記載
```

### Desktop scheduled tasks の設定

1. Claude Code デスクトップアプリを起動
2. Code タブ → Schedule ページを開く
3. 「New local task」を作成
4. 作業ディレクトリとしてこのリポジトリのパスを指定
5. 頻度を Hourly に設定
6. プロンプトに以下を入力:

```
config.yml を読み、CLAUDE.md の指示に従って GitHub Issue を処理してください。
```

## ライセンス

MIT
