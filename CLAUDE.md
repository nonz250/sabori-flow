# CLAUDE.md

このファイルは Claude Code Desktop scheduled tasks から定期実行される際の処理指示です。

## リポジトリ情報

- リポジトリ: `nonz250/claude-issue-worker`
- メインブランチ: `main`

## 処理手順

以下の手順に従って GitHub Issue を処理すること。

### 1. 設定の読み込み

`config.yml` を読み込み、対象リポジトリ一覧と実行設定を取得する。

### 2. Issue の取得

各リポジトリに対して `gh` コマンドで対象 Issue を取得する。

```bash
gh issue list --repo {owner}/{repo} --label {trigger_label} --state open --json number,title,body,labels
```

### 3. 優先度ソート

取得した Issue を以下の順で並べ替える:
1. `priority:high` ラベル付き（最優先）
2. `priority:low` ラベル付き
3. 優先度ラベルなし

### 4. Issue ごとの処理

`config.yml` の `execution.max_parallel` に従い、以下を実行する。

#### 4a. ラベル遷移（開始）

```bash
gh issue edit {number} --repo {owner}/{repo} --remove-label {trigger_label} --add-label {in_progress_label}
```

#### 4b. Issue の解決

1. 対象リポジトリをクローンまたは pull する
2. Issue の内容を分析し、修正方針を決定する
3. コードを修正する
4. テストが存在する場合は実行して通ることを確認する

#### 4c. 成功時

1. 修正をブランチに push する
2. Draft PR を作成する（Issue 番号を紐づける）
3. ラベルを遷移する

```bash
gh issue edit {number} --repo {owner}/{repo} --remove-label {in_progress_label} --add-label {done_label}
```

#### 4d. 失敗時

1. Issue にコメントで失敗理由を記載する
2. ラベルを遷移する

```bash
gh issue comment {number} --repo {owner}/{repo} --body "## Claude Auto - 自動解決失敗\n\n**理由:** {失敗理由の説明}"
gh issue edit {number} --repo {owner}/{repo} --remove-label {in_progress_label} --add-label {failed_label}
```

### 5. 処理の終了

すべての Issue の処理が完了したら終了する。対象 Issue がなかった場合は何もせず終了する。

## 制約事項

- `claude-in-progress` / `claude-done` / `claude-failed` ラベルが付いている Issue は処理対象外とする
- 1 回の実行で処理する Issue 数に上限は設けないが、レート制限に注意する
- PR のブランチ名は `claude-auto/{issue-number}` とする
- Draft PR の本文には対象 Issue へのリンクを含める
