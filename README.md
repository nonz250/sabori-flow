# claude-issue-worker

Claude Code Desktop scheduled tasks を使って GitHub Issue を自動的に検出し、定期的に対象 Issue を解決する仕組み。

## 概要

Claude Code デスクトップアプリの定期実行機能により、GitHub リポジトリの Issue をポーリングし、Claude Code が自律的に解決（方針策定・コード修正・Draft PR 作成）します。

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
- **plan フェーズ**: Issue の調査・方針策定を行い、Issue コメントとして方針を提示
- **impl フェーズ**: 方針に基づいてコード修正・Draft PR を作成
- ラベル遷移による処理状態の管理
- 優先度ラベル（`priority:high` / `priority:low`）による処理順の制御
- 失敗時の Issue コメントによるフィードバック

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
                                           ├─ 【plan フェーズ】
                                           │   ├─ claude/plan ラベル付き Issue を取得
                                           │   ├─ 優先度ラベルでソート
                                           │   ├─ ラベルを claude/plan:in-progress に遷移
                                           │   ├─ Issue を調査し方針を策定
                                           │   ├─ 成功 → 方針を Issue コメント + claude/plan:done
                                           │   └─ 失敗 → 理由を Issue コメント + claude/plan:failed
                                           │
                                           ├─ 【impl フェーズ】
                                           │   ├─ claude/impl ラベル付き Issue を取得
                                           │   ├─ 優先度ラベルでソート
                                           │   ├─ ラベルを claude/impl:in-progress に遷移
                                           │   ├─ 対象リポジトリをクローンし Issue を解決
                                           │   ├─ 成功 → Draft PR 作成 + claude/impl:done
                                           │   └─ 失敗 → 理由を Issue コメント + claude/impl:failed
```

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
