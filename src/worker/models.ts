import type { Language } from "../i18n/types.js";

// ---------- Enums (as const) ----------

/** 処理フェーズ */
export const Phase = {
  PLAN: "plan",
  IMPL: "impl",
} as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

/** 優先度（ソート順序を数値で表現） */
export const Priority = {
  HIGH: 0,
  LOW: 1,
  NONE: 2,
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

/**
 * Autonomy level passed to the AI CLI agent.
 *
 * Safety ordering (safer on the left):
 *   interactive > auto > full
 *
 * - INTERACTIVE: requires user approval for each action. Safest, but
 *   unsuitable for unattended launchd runs (blocks on approval prompts).
 * - AUTO: Claude Code's `--permission-mode auto`. The classifier blocks
 *   only dangerous actions (deploys, mass deletions, etc.) and
 *   auto-approves the rest. Recommended for unattended runs.
 * - FULL: maps to `--dangerously-skip-permissions`. Allows everything;
 *   use with caution.
 * - SANDBOXED: reserved value. Claude Code does not support it and
 *   falls back to interactive. Retained for future non-Claude CLIs
 *   (e.g. OpenAI Codex's `--sandbox`).
 */
export const Autonomy = {
  FULL: "full",
  AUTO: "auto",
  SANDBOXED: "sandboxed",
  INTERACTIVE: "interactive",
} as const;
export type Autonomy = (typeof Autonomy)[keyof typeof Autonomy];

// ---------- Data structures ----------

/** GitHub Issue */
export interface Issue {
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly labels: readonly string[];
  readonly url: string;
  readonly authorAssociation: string;
  readonly phase: Phase;
  readonly priority: Priority;
}

/** 1 フェーズ分のラベル定義 */
export interface PhaseLabels {
  readonly trigger: string;
  readonly inProgress: string;
  readonly done: string;
  readonly failed: string;
}

/** plan/impl 両フェーズのラベル定義 */
export interface LabelsConfig {
  readonly plan: PhaseLabels;
  readonly impl: PhaseLabels;
}

/** 1 リポジトリの設定 */
export interface RepositoryConfig {
  readonly owner: string;
  readonly repo: string;
  readonly localPath: string;
  readonly defaultBranch: string;
  readonly labels: LabelsConfig;
  readonly priorityLabels: readonly string[];
  readonly autoImplAfterPlan: boolean;
}

/** 実行設定 */
export interface ExecutionConfig {
  readonly maxParallel: number;
  readonly maxIssuesPerRepo: number;
  readonly autonomy: Autonomy;
  readonly intervalMinutes: number;
  readonly timeoutMinutes: number;
  readonly language: Language;
}

/** アプリケーション全体の設定 */
export interface AppConfig {
  readonly language: Language;
  readonly repositories: readonly RepositoryConfig[];
  readonly execution: ExecutionConfig;
}

// ---------- Failure diagnostics ----------

/**
 * Failure category for diagnostics.
 *
 * CLI_PERMISSION_DENIED is defined as a category only in this PR;
 * detection logic (stderr pattern matching) is intentionally deferred
 * to a follow-up PR so the pattern can be calibrated against real
 * Claude Code auto mode output.
 */
export const FailureCategory = {
  PROMPT_GENERATION: "prompt_generation",
  CLI_EXECUTION_ERROR: "cli_execution_error",
  CLI_NON_ZERO_EXIT: "cli_non_zero_exit",
  CLI_TIMEOUT: "cli_timeout",
  CLI_PERMISSION_DENIED: "cli_permission_denied",
  WORKTREE_CREATION: "worktree_creation",
  GIT_FETCH: "git_fetch",
} as const;
export type FailureCategory = (typeof FailureCategory)[keyof typeof FailureCategory];

/** Structured failure context for diagnostic comments */
export interface FailureDiagnostics {
  readonly category: FailureCategory;
  readonly summary: string;
  readonly stderr?: string;
  readonly stdout?: string;
  readonly exitCode?: number | null;
  readonly timeoutMs?: number;
  readonly errorMessage?: string;
}

// ---------- Helper functions ----------

/** リポジトリのフルネーム ("owner/repo") を返す */
export function repoFullName(config: RepositoryConfig): string {
  return `${config.owner}/${config.repo}`;
}
