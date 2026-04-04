export interface PlistPlaceholders {
  npxPath: string;
  path: string;
  logDir: string;
}

export function renderPlist(
  template: string,
  placeholders: PlistPlaceholders,
): string {
  return template
    .replace(/__LOG_DIR__/g, () => placeholders.logDir)
    .replace(/__NPX_PATH__/g, () => placeholders.npxPath)
    .replace(/__PATH__/g, () => placeholders.path);
}
