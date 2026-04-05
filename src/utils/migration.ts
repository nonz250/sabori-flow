import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getConfigPath } from "./paths.js";

export interface LegacyPathInfo {
  readonly hasLegacyConfig: boolean;
  readonly hasLegacyData: boolean;
  readonly legacyConfigPath: string;
  readonly legacyDataDir: string;
}

/**
 * Detect legacy XDG-based paths.
 * Only checks for legacy config if no config exists at the new path.
 */
export function detectLegacyPaths(): LegacyPathInfo {
  const legacyConfigPath = join(homedir(), ".config", "sabori-flow", "config.yml");
  const legacyDataDir = join(homedir(), ".local", "share", "sabori-flow");

  const newConfigExists = existsSync(getConfigPath());

  return {
    hasLegacyConfig: !newConfigExists && existsSync(legacyConfigPath),
    hasLegacyData: existsSync(legacyDataDir),
    legacyConfigPath,
    legacyDataDir,
  };
}

/**
 * Format migration guidance message.
 * Returns null if no legacy paths are detected.
 */
export function formatMigrationMessage(info: LegacyPathInfo): string | null {
  const lines: string[] = [];

  if (info.hasLegacyConfig) {
    lines.push(`  mv "${info.legacyConfigPath}" "${getConfigPath()}"`);
  }

  if (info.hasLegacyData) {
    lines.push(`  rm -rf "${info.legacyDataDir}"`);
  }

  return lines.length > 0 ? lines.join("\n") : null;
}
