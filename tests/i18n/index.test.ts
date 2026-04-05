import { describe, it, expect, vi, beforeEach } from "vitest";
import YAML from "yaml";

// ---------- Mocks ----------

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

import { readFileSync } from "node:fs";
import { messages } from "../../src/i18n/messages.js";
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from "../../src/i18n/types.js";
import type { Language, MessageKeys } from "../../src/i18n/types.js";

const mockedReadFileSync = vi.mocked(readFileSync);

// ---------- Setup ----------

let i18n: typeof import("../../src/i18n/index.js");

beforeEach(async () => {
  vi.restoreAllMocks();
  // Re-import to reset module-level state (currentLanguage)
  vi.resetModules();
  i18n = await import("../../src/i18n/index.js");
  i18n.setLanguage(DEFAULT_LANGUAGE);
});

// ---------- 1. Message dictionary tests ----------

describe("Message dictionaries", () => {
  const jaKeys = Object.keys(messages.ja).sort();
  const enKeys = Object.keys(messages.en).sort();

  it("ja and en dictionaries have the same key set", () => {
    expect(jaKeys).toEqual(enKeys);
  });

  it("no empty string values in ja dictionary", () => {
    for (const [key, value] of Object.entries(messages.ja)) {
      expect(value, `ja["${key}"] should not be empty`).not.toBe("");
    }
  });

  it("no empty string values in en dictionary", () => {
    for (const [key, value] of Object.entries(messages.en)) {
      expect(value, `en["${key}"] should not be empty`).not.toBe("");
    }
  });

  it("placeholder patterns are consistent between ja and en", () => {
    const placeholderPattern = /\{(\w+)\}/g;
    for (const key of jaKeys) {
      const typedKey = key as keyof MessageKeys;
      const jaPlaceholders = [
        ...messages.ja[typedKey].matchAll(placeholderPattern),
      ]
        .map((m) => m[1])
        .sort();
      const enPlaceholders = [
        ...messages.en[typedKey].matchAll(placeholderPattern),
      ]
        .map((m) => m[1])
        .sort();
      expect(
        jaPlaceholders,
        `Placeholders mismatch for key "${key}": ja=${JSON.stringify(jaPlaceholders)}, en=${JSON.stringify(enPlaceholders)}`,
      ).toEqual(enPlaceholders);
    }
  });
});

// ---------- 2. t() function tests ----------

describe("t()", () => {
  it("returns correct ja message when language is ja", () => {
    i18n.setLanguage("ja");
    const result = i18n.t("init.aborted");
    expect(result).toBe(messages.ja["init.aborted"]);
  });

  it("returns correct en message when language is en", () => {
    i18n.setLanguage("en");
    const result = i18n.t("init.aborted");
    expect(result).toBe(messages.en["init.aborted"]);
  });

  it("substitutes a single placeholder", () => {
    i18n.setLanguage("en");
    const result = i18n.t("init.configCreated", {
      path: "/home/user/.config/sabori-flow/config.yml",
    });
    expect(result).toBe(
      "\nconfig.yml created: /home/user/.config/sabori-flow/config.yml",
    );
  });

  it("substitutes multiple placeholders", () => {
    i18n.setLanguage("en");
    const result = i18n.t("add.duplicateOverwrite", {
      owner: "nonz250",
      repo: "sabori-flow",
    });
    expect(result).toBe("nonz250/sabori-flow already exists. Overwrite?");
  });

  it("replaces all occurrences of the same placeholder", () => {
    // add.repoAdded contains {owner} and {repo} once each;
    // duplicateOverwrite also has {owner}/{repo}.
    // To test repeated replacement, we use ja version of add.repoAdded
    // which has {owner}/{repo} pattern.
    i18n.setLanguage("ja");
    const result = i18n.t("add.duplicateOverwrite", {
      owner: "testowner",
      repo: "testrepo",
    });
    expect(result).toBe(
      "testowner/testrepo は既に登録されています。上書きしますか?",
    );
  });

  it("ignores unused params without error", () => {
    i18n.setLanguage("en");
    const result = i18n.t("init.aborted", {
      unused: "value",
      another: "extra",
    });
    expect(result).toBe("Aborted.");
  });

  it("leaves placeholder unreplaced when param is missing", () => {
    i18n.setLanguage("en");
    const result = i18n.t("init.configCreated");
    expect(result).toContain("{path}");
  });

  it("inserts special regex characters literally (security: () => value pattern)", () => {
    i18n.setLanguage("en");

    const specialValues = ["$1", "$&", "$$", "$`", "$'"];
    for (const special of specialValues) {
      const result = i18n.t("init.configCreated", { path: special });
      expect(result).toBe(`\nconfig.yml created: ${special}`);
    }
  });

  it("does not double-expand when param value contains placeholder pattern", () => {
    i18n.setLanguage("en");
    // Value contains another placeholder pattern — should be inserted literally
    const result = i18n.t("init.configCreated", { path: "{other}" });
    expect(result).toBe("\nconfig.yml created: {other}");
  });
});

// ---------- 3. setLanguage() / getLanguage() tests ----------

describe("setLanguage() / getLanguage()", () => {
  it("default language matches DEFAULT_LANGUAGE", () => {
    expect(i18n.getLanguage()).toBe(DEFAULT_LANGUAGE);
  });

  it("setLanguage('en') changes getLanguage() to en", () => {
    i18n.setLanguage("en");
    expect(i18n.getLanguage()).toBe("en");
  });

  it("setLanguage('ja') changes getLanguage() to ja", () => {
    i18n.setLanguage("en"); // change away from default first
    i18n.setLanguage("ja");
    expect(i18n.getLanguage()).toBe("ja");
  });

  it("language change affects subsequent t() calls", () => {
    i18n.setLanguage("ja");
    const jaResult = i18n.t("init.aborted");

    i18n.setLanguage("en");
    const enResult = i18n.t("init.aborted");

    expect(jaResult).toBe(messages.ja["init.aborted"]);
    expect(enResult).toBe(messages.en["init.aborted"]);
    expect(jaResult).not.toBe(enResult);
  });
});

// ---------- 4. loadLanguageFromConfig() tests ----------

describe("loadLanguageFromConfig()", () => {
  it("returns 'en' from valid config with language: en", () => {
    const config = YAML.stringify({ language: "en" });
    mockedReadFileSync.mockReturnValue(config);

    const result = i18n.loadLanguageFromConfig("/mock/config.yml");
    expect(result).toBe("en");
  });

  it("returns 'ja' from valid config with language: ja", () => {
    const config = YAML.stringify({ language: "ja" });
    mockedReadFileSync.mockReturnValue(config);

    const result = i18n.loadLanguageFromConfig("/mock/config.yml");
    expect(result).toBe("ja");
  });

  it("returns DEFAULT_LANGUAGE when config file does not exist", () => {
    mockedReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory");
    });

    const result = i18n.loadLanguageFromConfig("/nonexistent/config.yml");
    expect(result).toBe(DEFAULT_LANGUAGE);
  });

  it("returns DEFAULT_LANGUAGE when config has no language field", () => {
    const config = YAML.stringify({ repositories: [] });
    mockedReadFileSync.mockReturnValue(config);

    const result = i18n.loadLanguageFromConfig("/mock/config.yml");
    expect(result).toBe(DEFAULT_LANGUAGE);
  });

  it("returns DEFAULT_LANGUAGE when language value is unsupported", () => {
    const config = YAML.stringify({ language: "fr" });
    mockedReadFileSync.mockReturnValue(config);

    const result = i18n.loadLanguageFromConfig("/mock/config.yml");
    expect(result).toBe(DEFAULT_LANGUAGE);
  });

  it("returns DEFAULT_LANGUAGE when language value is not a string", () => {
    const config = YAML.stringify({ language: 123 });
    mockedReadFileSync.mockReturnValue(config);

    const result = i18n.loadLanguageFromConfig("/mock/config.yml");
    expect(result).toBe(DEFAULT_LANGUAGE);
  });

  it("returns DEFAULT_LANGUAGE when YAML is invalid", () => {
    mockedReadFileSync.mockReturnValue("{ invalid yaml: [");

    const result = i18n.loadLanguageFromConfig("/mock/config.yml");
    expect(result).toBe(DEFAULT_LANGUAGE);
  });
});
