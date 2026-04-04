export interface PlistPlaceholders {
  programArguments: readonly string[];
  path: string;
  logDir: string;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildProgramArgumentsXml(args: readonly string[]): string {
  const items = args
    .map((arg) => `    <string>${escapeXml(arg)}</string>`)
    .join("\n");
  return `<array>\n${items}\n</array>`;
}

export function renderPlist(
  template: string,
  placeholders: PlistPlaceholders,
): string {
  // 展開順序: logDir（内部由来）を先、programArguments と path（ユーザー入力由来）を後
  return template
    .replace(/__LOG_DIR__/g, () => escapeXml(placeholders.logDir))
    .replace(/__PROGRAM_ARGUMENTS__/g, () =>
      buildProgramArgumentsXml(placeholders.programArguments),
    )
    .replace(/__PATH__/g, () => escapeXml(placeholders.path));
}
