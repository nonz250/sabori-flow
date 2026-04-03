# sabori-flow

GitHub Issue に特定のラベルを付けるだけで、Claude Code CLI が自動的に方針策定・実装を行うワーカー。
macOS の launchd で 1 時間ごとに定期実行される。

## 前提条件

- macOS
- Python 3.x
- Node.js（Claude Code CLI がインストール済みであれば存在する）
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude`)
- [GitHub CLI](https://cli.github.com/) (`gh`) -- 認証済みであること

## セットアップ

```bash
# 1. CLI の依存インストール
cd cli && npm install && cd ..

# 2. 対話的に config.yml を作成
npx ts-node cli/src/index.ts init

# 3. セットアップ + 定期実行登録
npx ts-node cli/src/index.ts install
```

`install` コマンドは Python 仮想環境の作成、依存インストール、launchd への登録をまとめて行う。

## アンインストール

```bash
npx ts-node cli/src/index.ts uninstall
```

launchd からの登録解除と関連ファイルの削除が行われる。

## 運用

### 登録状況の確認

```bash
launchctl list | grep sabori-flow
```

```
-	0	com.github.nonz250.sabori-flow
```

左から PID（未実行なら `-`）、最後の終了コード、ラベル名。

### スケジュールを待たず即時実行

```bash
launchctl start com.github.nonz250.sabori-flow
```

### ログの確認

```
logs/worker.log              # ワーカーのログ（日次ローテーション、7日保持）
logs/launchd_stdout.log      # launchd 経由の標準出力
logs/launchd_stderr.log      # launchd 経由の標準エラー出力
```

## 使い方

Issue にラベルを付けるだけ。ワーカーが 1 時間ごとに自動検出して処理する。

```
あなたがやること                       ワーカーが自動でやること
-----------------------------------------------------------------------

  Issue にラベルを付ける               1時間ごとに Issue をチェック

  +-----------------+                  +---------------------+
  | Issue #42       |                  | claude/plan ラベル   |
  | Labels:         |   ---------->    | が付いた Issue を発見 |
  |  claude/plan    |                  +----------+----------+
  +-----------------+                             |
                                                  v
                                       +---------------------+
                                       | Plan フェーズ        |
                                       |                     |
                                       | label: -> in-progress
                                       | worktree 作成       |
                                       | claude -p で方針策定 |
                                       | label: -> done       |
                                       | 結果を Issue にコメント
                                       | worktree 削除       |
                                       +----------+----------+
                                                  |
                                                  v
  +-----------------+                  +---------------------+
  | コメントを確認   |<--------------  | Issue に方針コメント |
  | 方針に問題なければ|                  | が投稿される        |
  | impl ラベルを付与 |                  +---------------------+
  +--------+--------+
           |
           |  claude/impl ラベルを追加
           v
  +-----------------+                  +---------------------+
  | Issue #42       |                  | Impl フェーズ        |
  | Labels:         |   ---------->    |                     |
  |  claude/impl    |                  | label: -> in-progress
  +-----------------+                  | worktree 作成       |
                                       | claude -p で実装     |
                                       | PR 作成 (close #42)  |
                                       | label: -> done       |
                                       | 結果を Issue にコメント
                                       | worktree 削除       |
                                       +----------+----------+
                                                  |
                                                  v
  +-----------------+                  +---------------------+
  | PR をレビュー    |<--------------  | PR が作成される      |
  | マージ           |                  | close #42 付き      |
  +-----------------+                  +---------------------+
```

### ラベル遷移

```
  あなたが付ける          ワーカーが自動遷移
  --------------     ------------------------------------------

  claude/plan  -->  claude/plan:in-progress  --+--> claude/plan:done
                                               +--> claude/plan:failed

  claude/impl  -->  claude/impl:in-progress  --+--> claude/impl:done
                                               +--> claude/impl:failed
```

### 失敗した場合

`failed` ラベルが付き、Issue に失敗コメントが投稿される。

1. `logs/worker.log` で詳細を確認
2. Issue の内容を修正
3. `failed` ラベルを外して、再度 `claude/plan` または `claude/impl` を付ける

## config.yml

`config.yml.example` を参考に作成する。`npx ts-node cli/src/index.ts init` で対話的に生成することもできる。

```yaml
repositories:
  - owner: nonz250              # リポジトリオーナー
    repo: example-app           # リポジトリ名
    local_path: /path/to/repo   # ローカルのクローン先パス
    labels:                     # ラベル名のカスタマイズ（省略時はデフォルト値）
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
    priority_labels:            # 優先度ラベル（上から高い順）
      - priority:high
      - priority:low

execution:
  max_parallel: 1               # 並列実行数（デフォルト: 1）
```

| 項目 | 説明 |
|------|------|
| `repositories[].owner` | リポジトリオーナー |
| `repositories[].repo` | リポジトリ名 |
| `repositories[].local_path` | ローカルのクローン先パス |
| `repositories[].labels` | 各フェーズのラベル名（カスタマイズ可能） |
| `repositories[].priority_labels` | 優先度ラベル。リストの上位ほど先に処理される |
| `execution.max_parallel` | 並列実行数。デフォルトは 1（逐次実行） |

## プロンプトのカスタマイズ

Claude Code CLI に渡すプロンプトは以下のファイルで管理されている。

- `prompts/plan.md` -- 方針策定フェーズのプロンプト
- `prompts/impl.md` -- 実装フェーズのプロンプト

プロジェクトに合わせて編集することで、Claude Code の振る舞いを調整できる。
プロンプト内のプレースホルダー（`{repo_full_name}`, `{issue_number}`, `{issue_title}`, `{issue_url}`, `{issue_body}`）はワーカーが実行時に自動置換する。

## ライセンス

MIT
