export interface PlistPlaceholders {
  nodePath: string;
  projectRoot: string;
  path: string;
  logDir: string;
}

export function renderPlist(
  template: string,
  placeholders: PlistPlaceholders,
): string {
  return template
    .replace(/__PROJECT_ROOT__/g, () => placeholders.projectRoot)
    .replace(/__LOG_DIR__/g, () => placeholders.logDir)
    .replace(/__NODE_PATH__/g, () => placeholders.nodePath)
    .replace(/__PATH__/g, () => placeholders.path);
}
