# claude-issue-worker

Python スクリプトと Claude Code CLI を使って GitHub Issue を自動的に検出し、定期的に対象 Issue を解決する仕組み。

## 概要

ローカルマシンのスケジューラ（launchd / cron）で Python スクリプトを定期実行し、GitHub Issue のポーリング・ラベル管理を行います。Issue の実際の解決には Claude Code CLI を非対話モードで呼び出します。

### リポジトリ構成

```
claude-issue-worker/
├── CLAUDE.md              # 開発時の Claude Code への指示
├── README.md              # ドキュメント
├── config.yml             # 対象リポジトリ・ラベル・実行設定
├── src/
│   ├── main.py            # エントリポイント
│   ├── config.py          # config.yml の読み込み
│   ├── fetcher.py         # Issue 取得・フィルタリング・ソート
│   ├── labeler.py         # ラベル遷移管理
│   ├── planner.py         # plan フェーズ（Claude Code CLI で方針策定）
│   └── implementer.py     # impl フェーズ（Claude Code CLI で実装）
└── launchd/
    └── com.nonz250.claude-issue-worker.plist  # macOS launchd 定義
```

### 主な機能

- 複数リポジトリの GitHub Issue を定期的に検出・取得
- **plan フェーズ**: Issue の調査・方針策定を行い、Issue コメントとして方針を提示
- **impl フェーズ**: 方針に基づいてコード修正・Draft PR を作成
- ラベル遷移による処理状態の管理
- 優先度ラベル（`priority:high` / `priority:low`）による処理順の制御
- 失敗時の Issue コメントによるフィードバック

## アーキテクチャ

### 実行基盤

macOS の launchd（または cron）で Python スクリプトを 1 時間ごとに定期実行します。

### 処理フロー

```
[launchd/cron] ─(1時間ごと)─> [Python: main.py]
                                  │
                                  ├─ config.yml から対象リポジトリ一覧を取得
                                  ├─ gh コマンドで Issue を取得・ラベル遷移
                                  │
                                  ├─ 【plan フェーズ】
                                  │   ├─ claude/plan ラベル付き Issue を取得
                                  │   ├─ 優先度ラベルでソート
                                  │   ├─ ラベルを claude/plan:in-progress に遷移
                                  │   ├─ Claude Code CLI で方針策定
                                  │   ├─ 成功 → 方針を Issue コメント + claude/plan:done
                                  │   └─ 失敗 → 理由を Issue コメント + claude/plan:failed
                                  │
                                  ├─ 【impl フェーズ】
                                  │   ├─ claude/impl ラベル付き Issue を取得
                                  │   ├─ 優先度ラベルでソート
                                  │   ├─ ラベルを claude/impl:in-progress に遷移
                                  │   ├─ Claude Code CLI で実装
                                  │   ├─ 成功 → Draft PR 作成 + claude/impl:done
                                  │   └─ 失敗 → 理由を Issue コメント + claude/impl:failed
```

### 責務分担

| レイヤー | 担当 |
|----------|------|
| スケジューリング | launchd / cron |
| Issue 取得・ラベル管理・ログ | Python スクリプト（`gh` コマンド経由） |
| Issue の解決（方針策定・実装） | Claude Code CLI（`claude -p "プロンプト"` で非対話実行） |

### ラベル遷移

#### plan フェーズ

```
claude/plan → claude/plan:in-progress → claude/plan:done
                                      → claude/plan:failed
```

#### impl フェーズ

```
claude/impl → claude/impl:in-progress → claude/impl:done
                                       → claude/impl:failed
```

#### 全体フロー

```
[人間] claude/plan 付与
  → 方針策定 → claude/plan:done（方針を Issue にコメント）
  → [人間が確認] → claude/impl 付与
  → 実装 → claude/impl:done（Draft PR 作成）
```

| ラベル | 状態 |
|--------|------|
| `claude/plan` | 方針策定を依頼（人間が付与） |
| `claude/plan:in-progress` | 方針策定中 |
| `claude/plan:done` | 方針策定完了（Issue にコメント済み） |
| `claude/plan:failed` | 方針策定失敗 |
| `claude/impl` | 実装を依頼（人間が付与） |
| `claude/impl:in-progress` | 実装中 |
| `claude/impl:done` | 実装完了（Draft PR 作成済み） |
| `claude/impl:failed` | 実装失敗 |

## 設定ファイル

`config.yml` で対象リポジトリと実行設定を管理します。

```yaml
# 対象リポジトリ
repositories:
  - owner: nonz250
    repo: example-app
    labels:
      plan:
        trigger: claude/plan
        in_progress: "claude/plan:in-progress"
        done: "claude/plan:done"
        failed: "claude/plan:failed"
      impl:
        trigger: claude/impl
        in_progress: "claude/impl:in-progress"
        done: "claude/impl:done"
        failed: "claude/impl:failed"
    priority_labels:
      - priority:high
      - priority:low

# 実行設定
execution:
  max_parallel: 1
```

## 前提条件

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) がインストール済みであること
- Claude Code Max プランのサブスクリプション
- GitHub CLI (`gh`) がインストール・認証済みであること
- Python 3.x
- 対象リポジトリへの書き込み権限があること

## セットアップ

```bash
git clone git@github.com:nonz250/claude-issue-worker.git
cd claude-issue-worker
cp config.yml.example config.yml  # 設定ファイルを作成し、対象リポジトリを記載
```

### launchd の設定（macOS）

```bash
cp launchd/com.nonz250.claude-issue-worker.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.nonz250.claude-issue-worker.plist
```

### 手動実行

```bash
python src/main.py
```

## ライセンス

MIT
