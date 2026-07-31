import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";

import type { Language } from "../i18n/types.js";
import { getUserPromptsDir, getUserPromptsLanguageDir } from "../utils/paths.js";
import { TEMPLATE_FILES } from "./prompt.js";
import { createLogger } from "./logger.js";

const logger = createLogger("prompt-migration");

/**
 * Migrate flat prompt templates into a language-specific subdirectory.
 *
 * The actual language of flat-side templates is unknown; we use the
 * config.yml `language` value as the target directory label.
 */
export function migrateFlatPromptTemplates(language: Language): void {
  const flatDir = getUserPromptsDir();
  const langDir = getUserPromptsLanguageDir(language);

  for (const filename of Object.values(TEMPLATE_FILES)) {
    const src = join(flatDir, filename);
    if (!existsSync(src)) {
      continue;
    }

    const dest = join(langDir, filename);
    if (existsSync(dest)) {
      // Preserve user customizations; let the user merge manually.
      logger.warn(
        "Skipping migration: both %s and %s exist",
        src,
        dest,
      );
      continue;
    }

    // Per-file try/catch so one failure does not block others;
    // unmigrated files will be retried on the next startup.
    try {
      mkdirSync(langDir, { recursive: true, mode: 0o700 });
      renameSync(src, dest);
      logger.info("Migrated %s -> %s", src, dest);
    } catch (error: unknown) {
      logger.warn("Failed to migrate %s: %s", filename, error);
    }
  }
}
