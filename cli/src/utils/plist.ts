export interface PlistPlaceholders {
  pythonPath: string;
  projectRoot: string;
  path: string;
  logDir: string;
}

export function renderPlist(
  template: string,
  placeholders: PlistPlaceholders,
): string {
  return template
    .replace(/__PYTHON_PATH__/g, placeholders.pythonPath)
    .replace(/__PROJECT_ROOT__/g, placeholders.projectRoot)
    .replace(/__PATH__/g, placeholders.path)
    .replace(/__LOG_DIR__/g, placeholders.logDir);
}
