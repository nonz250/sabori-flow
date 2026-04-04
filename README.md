<div align="center">

<img src="assets/logo.svg" alt="sabori-flow" width="480">

<p><strong>Automated GitHub Issue resolver powered by Claude Code CLI.</strong><br>
Add a label to an Issue -- sabori-flow handles the rest: planning, implementation, and pull request creation.</p>

<p>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Node.js-v20%2B-339933?logo=node.js&logoColor=white" alt="Node.js v20+">
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Platform-macOS-000000?logo=apple&logoColor=white" alt="macOS">
</p>

<p>
  <a href="README.md">English</a> | <a href="README.ja.md">日本語</a>
</p>

</div>

## Prerequisites

- macOS
- Node.js v20+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude`)
- [GitHub CLI](https://cli.github.com/) (`gh`) -- must be authenticated

## Setup

```bash
# 1. Create config.yml interactively
npx sabori-flow init

# 2. Register with launchd for periodic execution
npx sabori-flow install
```

The `install` command generates the plist file and registers with launchd.

### Adding a Repository

To add a new repository to an existing `config.yml`:

```bash
npx sabori-flow add
```

This interactively prompts for owner, repo, and local path, then appends the entry to `config.yml`. If the same owner/repo already exists, you will be asked whether to overwrite it.

### Uninstall

```bash
npx sabori-flow uninstall
```

This unregisters from launchd and removes related files.

## Usage

### Workflow

Add a label to an Issue. The worker automatically detects it every hour and processes it.

```mermaid
flowchart TD
    A["User adds claude/plan label to Issue"] --> B["Worker runs Plan Phase"]
    B --> C{"Plan succeeded?"}
    C -- Yes --> D["Plan comment posted to Issue"]
    C -- No --> E["claude/plan:failed label applied"]
    D --> F["User reviews plan and adds claude/impl label"]
    F --> G["Worker runs Impl Phase"]
    G --> H{"Impl succeeded?"}
    H -- Yes --> I["Pull Request created"]
    H -- No --> J["claude/impl:failed label applied"]
```

### Label Transitions

```mermaid
flowchart LR
    A["claude/plan"] --> B["claude/plan:in-progress"]
    B --> C["claude/plan:done"]
    B --> D["claude/plan:failed"]

    E["claude/impl"] --> F["claude/impl:in-progress"]
    F --> G["claude/impl:done"]
    F --> H["claude/impl:failed"]
```

### Handling Failures

When processing fails, a `failed` label is applied and a failure comment is posted to the Issue.

1. Check `~/.sabori-flow/logs/worker.log` for details
2. Fix the Issue content as needed
3. Remove the `failed` label and re-apply `claude/plan` or `claude/impl`

### Operations

**Check registration status:**

```bash
launchctl list | grep sabori-flow
```

```
-	0	com.github.nonz250.sabori-flow
```

The columns are: PID (`-` if not running), last exit code, and label name.

**Run immediately without waiting for schedule:**

```bash
launchctl start com.github.nonz250.sabori-flow
```

**Log locations:**

```
~/.sabori-flow/logs/worker.log              # Worker log (daily rotation, 7-day retention)
~/.sabori-flow/logs/launchd_stdout.log      # stdout via launchd
~/.sabori-flow/logs/launchd_stderr.log      # stderr via launchd
```

## Configuration

The configuration file is stored at `~/.config/sabori-flow/config.yml`. Create it based on `config.yml.example`, or generate it interactively with `npx sabori-flow init`.

```yaml
repositories:
  - owner: nonz250
    repo: example-app
    local_path: /path/to/repo
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

execution:
  max_parallel: 1
  max_issues_per_repo: 1
```

| Key | Description |
|-----|-------------|
| `repositories[].owner` | Repository owner |
| `repositories[].repo` | Repository name |
| `repositories[].local_path` | Local path to the cloned repository |
| `repositories[].labels` | Label names for each phase (customizable) |
| `repositories[].labels.plan` | Labels for the plan phase: `trigger`, `in_progress`, `done`, `failed` |
| `repositories[].labels.impl` | Labels for the impl phase: `trigger`, `in_progress`, `done`, `failed` |
| `repositories[].priority_labels` | Priority labels. Issues with labels higher in the list are processed first |
| `execution.max_parallel` | Number of parallel executions. Default is `1` (sequential) |
| `execution.max_issues_per_repo` | Maximum number of issues to process per repository. Default is `1` |

## Security

This tool runs Claude Code CLI with `--dangerously-skip-permissions`, which allows nearly arbitrary operations on your machine. It is executed periodically by launchd without user interaction.

By default, the `npx` installation fetches packages from the npm registry at runtime. If the npm package were compromised, malicious code could be executed automatically by the scheduler.

Additionally, the following defenses are built in:

- **Author permission check** -- Only issues created by users with OWNER, MEMBER, or COLLABORATOR association are processed; others are automatically skipped.
- **Secret masking** -- Before posting a success comment, output is scanned and secrets are automatically masked.
- **Random boundary tokens** -- Prompts use randomized boundary tokens to mitigate prompt injection.

To mitigate this risk, use the `--local` flag to run from a locally built copy you can audit:

```bash
git clone https://github.com/nonz250/sabori-flow.git
cd sabori-flow
npm install
npm run build
node dist/index.js init
node dist/index.js install --local
```

## License

[MIT](LICENSE)
