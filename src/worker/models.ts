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

/** CLI execution agent */
export const Agent = {
  CLAUDE: "claude",
  CODEX: "codex",
} as const;
export type Agent = (typeof Agent)[keyof typeof Agent];

/** Autonomy level for CLI execution */
export const Autonomy = {
  FULL: "full",
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
  readonly labels: LabelsConfig;
  readonly priorityLabels: readonly string[];
  readonly autoImplAfterPlan: boolean;
}

/** 実行設定 */
export interface ExecutionConfig {
  readonly maxParallel: number;
  readonly maxIssuesPerRepo: number;
  readonly agent: Agent;
  readonly autonomy: Autonomy;
  readonly intervalMinutes: number;
  readonly language: Language;
}

/** アプリケーション全体の設定 */
export interface AppConfig {
  readonly language: Language;
  readonly repositories: readonly RepositoryConfig[];
  readonly execution: ExecutionConfig;
}

// ---------- Helper functions ----------

/** リポジトリのフルネーム ("owner/repo") を返す */
export function repoFullName(config: RepositoryConfig): string {
  return `${config.owner}/${config.repo}`;
}
