// Shared by every config.yml reader (worker config loader, show command's
// raw-document inspector, add command, i18n language loader) so they all
// apply the same YAML alias limit.
export const CONFIG_YAML_PARSE_OPTIONS = { maxAliasCount: 100 } as const;

export function getDefaultPriorityLabels(): string[] {
  return ["priority:high", "priority:low"];
}

export function getDefaultExecution() {
  return {
    max_parallel: 1,
    max_issues_per_repo: 1,
    autonomy: "interactive",
    interval_minutes: 10,
    timeout_minutes: 60,
  };
}
