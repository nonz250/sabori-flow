import type {
  ConfigInspection,
  RepositoryInspection,
  Sourced,
} from "../../worker/config-inspect.js";
import type { LabelsConfig, PhaseLabels } from "../../worker/models.js";

// ---------- Public types ----------

export interface RenderOptions {
  readonly verbose: boolean;
}

export interface RenderedConfig {
  readonly lines: readonly string[];
  readonly hasDefaultValues: boolean;
}

// ---------- Constants ----------

const DEFAULT_MARKER = "*";
const COLUMN_GAP = 2;

const REPO_HEADERS = [
  "REPOSITORY",
  "BRANCH",
  "AUTO_IMPL",
  "LABELS",
  "PRIORITY",
  "LOCAL_PATH",
] as const;

// ---------- Public API ----------

export function renderConfigInspection(
  inspection: ConfigInspection,
  options: RenderOptions,
): RenderedConfig {
  let hasDefaultValues = false;

  const sections: string[][] = [];

  const { repoLines, repoHasDefaults } = renderRepositoryTable(
    inspection.repositories,
  );
  if (repoHasDefaults) hasDefaultValues = true;
  sections.push(repoLines);

  const labelSections = renderLabelSections(
    inspection.repositories,
    options.verbose,
  );
  if (labelSections.length > 0) {
    sections.push(labelSections);
  }

  const localPathSections = renderLocalPathSections(
    inspection.repositories,
    options.verbose,
  );
  if (localPathSections.length > 0) {
    sections.push(localPathSections);
  }

  const { executionLines, executionHasDefaults } = renderExecutionSection(
    inspection.execution,
  );
  if (executionHasDefaults) hasDefaultValues = true;
  sections.push(executionLines);

  const { languageLines, languageHasDefaults } = renderLanguageSection(
    inspection.language,
  );
  if (languageHasDefaults) hasDefaultValues = true;
  sections.push(languageLines);

  const lines = sections.reduce<string[]>((acc, section, i) => {
    if (i > 0) acc.push("");
    acc.push(...section);
    return acc;
  }, []);

  return { lines, hasDefaultValues };
}

// ---------- Repository table ----------

function renderRepositoryTable(repos: readonly RepositoryInspection[]): {
  repoLines: string[];
  repoHasDefaults: boolean;
} {
  let repoHasDefaults = false;

  const rows: string[][] = [];
  for (const repo of repos) {
    const branch = formatSourced(repo.defaultBranch);
    const autoImpl = formatSourced(repo.autoImplAfterPlan);
    const labels = repo.labels.matchesDefault ? "default" : "custom";
    const priority = repo.priorityLabels.matchesDefault
      ? "default"
      : "custom";

    if (
      repo.defaultBranch.source === "default" ||
      repo.autoImplAfterPlan.source === "default"
    ) {
      repoHasDefaults = true;
    }

    rows.push([
      repo.fullName,
      branch,
      autoImpl,
      labels,
      priority,
      repo.localPath,
    ]);
  }

  const columnWidths = computeColumnWidths([...REPO_HEADERS], rows);

  const repoLines: string[] = [];
  repoLines.push(`repositories (${repos.length})`);
  repoLines.push(formatTableRow([...REPO_HEADERS], columnWidths));
  for (const row of rows) {
    repoLines.push(formatTableRow(row, columnWidths));
  }

  return { repoLines, repoHasDefaults };
}

// ---------- Label detail sections ----------

function renderLabelSections(
  repos: readonly RepositoryInspection[],
  verbose: boolean,
): string[] {
  const lines: string[] = [];

  for (const repo of repos) {
    const showLabels =
      verbose || !repo.labels.matchesDefault;
    const showPriority =
      verbose || !repo.priorityLabels.matchesDefault;

    if (!showLabels && !showPriority) continue;

    if (showLabels) {
      if (lines.length > 0) lines.push("");
      lines.push(`${repo.fullName} labels`);
      lines.push(...renderKeyValueLines(buildLabelEntries(repo.labels.value)));
    }

    if (showPriority) {
      if (lines.length > 0 && !showLabels) lines.push("");
      lines.push(`${repo.fullName} priority_labels`);
      for (const label of repo.priorityLabels.value) {
        lines.push(`  ${label}`);
      }
    }
  }

  return lines;
}

// Key order follows config.yml's schema so the block can be copied back into
// the file as-is.
function buildLabelEntries(labels: LabelsConfig): [string, string][] {
  return [
    ...phaseLabelEntries("spec", labels.spec),
    ["spec.review", labels.spec.review],
    ["spec.approved", labels.spec.approved],
    ["spec.needs_human", labels.spec.needsHuman],
    ...phaseLabelEntries("plan", labels.plan),
    ...phaseLabelEntries("impl", labels.impl),
  ];
}

function phaseLabelEntries(
  phase: string,
  labels: PhaseLabels,
): [string, string][] {
  return [
    [`${phase}.trigger`, labels.trigger],
    [`${phase}.in_progress`, labels.inProgress],
    [`${phase}.done`, labels.done],
    [`${phase}.failed`, labels.failed],
  ];
}

// ---------- Local path sections (verbose only) ----------

function renderLocalPathSections(
  repos: readonly RepositoryInspection[],
  verbose: boolean,
): string[] {
  if (!verbose) return [];

  const lines: string[] = [];
  for (const repo of repos) {
    if (
      repo.rawLocalPath === null ||
      repo.rawLocalPath === repo.localPath
    ) {
      continue;
    }
    if (lines.length > 0) lines.push("");
    lines.push(`${repo.fullName} local_path`);
    lines.push(
      ...renderKeyValueLines([
        ["config", repo.rawLocalPath],
        ["resolved", repo.localPath],
      ]),
    );
  }
  return lines;
}

// ---------- Execution section ----------

function renderExecutionSection(execution: ConfigInspection["execution"]): {
  executionLines: string[];
  executionHasDefaults: boolean;
} {
  let executionHasDefaults = false;

  const entries: [string, string][] = [
    ["max_parallel", formatSourced(execution.maxParallel)],
    ["max_issues_per_repo", formatSourced(execution.maxIssuesPerRepo)],
    ["autonomy", formatSourced(execution.autonomy)],
    ["interval_minutes", formatSourced(execution.intervalMinutes)],
    ["timeout_minutes", formatSourced(execution.timeoutMinutes)],
  ];

  const sourcedFields = [
    execution.maxParallel,
    execution.maxIssuesPerRepo,
    execution.autonomy,
    execution.intervalMinutes,
    execution.timeoutMinutes,
  ];
  if (sourcedFields.some((s) => s.source === "default")) {
    executionHasDefaults = true;
  }

  const executionLines = ["execution", ...renderKeyValueLines(entries)];
  return { executionLines, executionHasDefaults };
}

// ---------- Language section ----------

function renderLanguageSection(language: Sourced<string>): {
  languageLines: string[];
  languageHasDefaults: boolean;
} {
  const formatted = formatSourced(language);
  const languageHasDefaults = language.source === "default";
  return {
    languageLines: ["language", `  ${formatted}`],
    languageHasDefaults,
  };
}

// ---------- Shared formatting helpers ----------

function formatSourced<T>(sourced: Sourced<T>): string {
  const text = String(sourced.value);
  return sourced.source === "default" ? `${text}${DEFAULT_MARKER}` : text;
}

function renderKeyValueLines(entries: [string, string][]): string[] {
  const maxKeyLength = Math.max(...entries.map(([key]) => key.length));
  return entries.map(([key, value]) => {
    const padding = " ".repeat(maxKeyLength - key.length + COLUMN_GAP);
    return `  ${key}${padding}${value}`;
  });
}

function computeColumnWidths(
  headers: string[],
  rows: string[][],
): number[] {
  return headers.map((header, colIndex) => {
    const cellLengths = rows.map((row) => row[colIndex].length);
    return Math.max(header.length, ...cellLengths);
  });
}

function formatTableRow(cells: string[], columnWidths: number[]): string {
  return cells
    .map((cell, i) => {
      if (i === cells.length - 1) return cell;
      return cell.padEnd(columnWidths[i] + COLUMN_GAP);
    })
    .join("");
}
