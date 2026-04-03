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
    .replace(/__NODE_PATH__/g, placeholders.nodePath)
    .replace(/__PROJECT_ROOT__/g, placeholders.projectRoot)
    .replace(/__PATH__/g, placeholders.path)
    .replace(/__LOG_DIR__/g, placeholders.logDir);
}
