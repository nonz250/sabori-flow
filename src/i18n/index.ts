import { readFileSync } from "node:fs";
import YAML from "yaml";
import type { Language, MessageKeys } from "./types.js";
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from "./types.js";
import { messages } from "./messages.js";

export type { Language, MessageKeys } from "./types.js";
export { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from "./types.js";

let currentLanguage: Language = DEFAULT_LANGUAGE;

export function setLanguage(lang: Language): void {
  currentLanguage = lang;
}

export function getLanguage(): Language {
  return currentLanguage;
}

export function t(
  key: keyof MessageKeys,
  params?: Record<string, string>,
): string {
  const template = messages[currentLanguage][key];
  if (!params) {
    return template;
  }
  return template.replaceAll(/\{(\w+)\}/g, (match, paramKey: string) => {
    return paramKey in params ? params[paramKey] : match;
  });
}

/**
 * Lightweight language loader from config.yml.
 * Falls back to DEFAULT_LANGUAGE on any error.
 * CLI commands only. Not designed for concurrent use in worker.
 */
export function loadLanguageFromConfig(configPath: string): Language {
  try {
    const raw = readFileSync(configPath, "utf-8");
    const data = YAML.parse(raw, { maxAliasCount: 100 }) as unknown;
    if (data !== null && typeof data === "object" && !Array.isArray(data)) {
      const record = data as Record<string, unknown>;
      const lang = record["language"];
      if (
        typeof lang === "string" &&
        SUPPORTED_LANGUAGES.includes(lang as Language)
      ) {
        return lang as Language;
      }
    }
  } catch {
    // Fall back to default
  }
  return DEFAULT_LANGUAGE;
}
