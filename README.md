# claude-issue-worker

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

## 使い方

1. `config.yml` に対象リポジトリを登録する
2. 対象リポジトリの Issue に以下のラベルを付ける
   - `claude/plan` -- 方針策定を依頼
   - `claude/impl` -- 実装を依頼（事前に plan が完了していることを推奨）
3. ワーカーが次回実行時に Issue を検出し、Claude Code CLI で処理する

## ラベル遷移

各フェーズでラベルが自動的に遷移する。

**plan フェーズ:**

```
claude/plan -> claude/plan:in-progress -> claude/plan:done / claude/plan:failed
```

**impl フェーズ:**

```
claude/impl -> claude/impl:in-progress -> claude/impl:done / claude/impl:failed
```

処理の成否に応じて `done` または `failed` ラベルが付与される。
失敗時はログを確認し、Issue を修正して再度トリガーラベルを付けることで再実行できる。

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
