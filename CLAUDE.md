# CLAUDE.md

このファイルは Claude Code Desktop scheduled tasks から定期実行される際の処理指示です。

## リポジトリ情報

- リポジトリ: `nonz250/claude-issue-worker`
- メインブランチ: `main`

## 処理手順

以下の手順に従って GitHub Issue を処理すること。
処理は **plan フェーズ** と **impl フェーズ** の 2 段階で行う。

### 1. 設定の読み込み

`config.yml` を読み込み、対象リポジトリ一覧と実行設定を取得する。

### 2. plan フェーズ（方針策定）

#### 2a. Issue の取得

各リポジトリに対して `claude/plan` ラベル付き Issue を取得する。

```bash
gh issue list --repo {owner}/{repo} --label "claude/plan" --state open --json number,title,body,labels
```

#### 2b. 優先度ソート

取得した Issue を以下の順で並べ替える:
1. `priority:high` ラベル付き（最優先）
2. `priority:low` ラベル付き
3. 優先度ラベルなし

#### 2c. Issue ごとの処理

##### ラベル遷移（開始）

```bash
gh issue edit {number} --repo {owner}/{repo} --remove-label "claude/plan" --add-label "claude/plan:in-progress"
```

##### 方針策定

1. 対象リポジトリをクローンまたは pull する
2. Issue の内容を分析する
3. コードベースを調査し、修正方針を策定する
4. 影響範囲・リスク・修正手順を整理する

##### 成功時

Issue に方針をコメントし、ラベルを遷移する。

```bash
gh issue comment {number} --repo {owner}/{repo} --body "## Claude Auto - 方針策定完了\n\n{方針の詳細}"
gh issue edit {number} --repo {owner}/{repo} --remove-label "claude/plan:in-progress" --add-label "claude/plan:done"
```

##### 失敗時

Issue に失敗理由をコメントし、ラベルを遷移する。

```bash
gh issue comment {number} --repo {owner}/{repo} --body "## Claude Auto - 方針策定失敗\n\n**理由:** {失敗理由の説明}"
gh issue edit {number} --repo {owner}/{repo} --remove-label "claude/plan:in-progress" --add-label "claude/plan:failed"
```

### 3. impl フェーズ（実装）

#### 3a. Issue の取得

各リポジトリに対して `claude/impl` ラベル付き Issue を取得する。

```bash
gh issue list --repo {owner}/{repo} --label "claude/impl" --state open --json number,title,body,labels,comments
```

#### 3b. 優先度ソート

plan フェーズと同じ優先度ルールでソートする。

#### 3c. Issue ごとの処理

##### ラベル遷移（開始）

```bash
gh issue edit {number} --repo {owner}/{repo} --remove-label "claude/impl" --add-label "claude/impl:in-progress"
```

##### 実装

1. 対象リポジトリをクローンまたは pull する
2. Issue のコメント欄から方針（plan フェーズの成果物）を確認する
3. 方針に基づいてコードを修正する
4. テストが存在する場合は実行して通ることを確認する

##### 成功時

1. 修正をブランチに push する（ブランチ名: `claude-auto/{issue-number}`）
2. Draft PR を作成する（Issue 番号を紐づける）
3. ラベルを遷移する

```bash
gh issue edit {number} --repo {owner}/{repo} --remove-label "claude/impl:in-progress" --add-label "claude/impl:done"
```

##### 失敗時

Issue に失敗理由をコメントし、ラベルを遷移する。

```bash
gh issue comment {number} --repo {owner}/{repo} --body "## Claude Auto - 実装失敗\n\n**理由:** {失敗理由の説明}"
gh issue edit {number} --repo {owner}/{repo} --remove-label "claude/impl:in-progress" --add-label "claude/impl:failed"
```

### 4. 処理の終了

すべての Issue の処理が完了したら終了する。対象 Issue がなかった場合は何もせず終了する。

## 制約事項

- 処理中・完了・失敗のラベルが付いている Issue は処理対象外とする
- 1 回の実行で処理する Issue 数に上限は設けないが、レート制限に注意する
- impl フェーズの PR ブランチ名は `claude-auto/{issue-number}` とする
- Draft PR の本文には対象 Issue へのリンクを含める
- plan フェーズでは方針の策定のみを行い、コード修正は行わない
- impl フェーズでは plan フェーズで策定された方針（Issue コメント）を参照して実装する
