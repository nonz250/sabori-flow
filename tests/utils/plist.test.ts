import { describe, it, expect } from "vitest";
import { renderPlist } from "../../src/utils/plist.js";
import type { PlistPlaceholders } from "../../src/utils/plist.js";

// ---------- Helpers ----------

function makePlaceholders(
  overrides?: Partial<PlistPlaceholders>,
): PlistPlaceholders {
  return {
    npxPath: "/usr/local/bin/npx",
    path: "/usr/local/bin:/usr/bin:/bin",
    logDir: "/home/user/.local/share/sabori-flow/logs",
    ...overrides,
  };
}

const TEMPLATE = [
  "<string>__NPX_PATH__</string>",
  "<string>__PATH__</string>",
  "<string>__LOG_DIR__</string>",
].join("\n");

// ---------- Tests ----------

describe("renderPlist", () => {
  describe("正常系: 各プレースホルダが正しく展開される", () => {
    it("__NPX_PATH__ が npxPath の値に展開される", () => {
      const placeholders = makePlaceholders();

      const result = renderPlist(TEMPLATE, placeholders);

      expect(result).toContain("<string>/usr/local/bin/npx</string>");
    });

    it("__PATH__ が path の値に展開される", () => {
      const placeholders = makePlaceholders();

      const result = renderPlist(TEMPLATE, placeholders);

      expect(result).toContain(
        "<string>/usr/local/bin:/usr/bin:/bin</string>",
      );
    });

    it("__LOG_DIR__ が logDir の値に展開される", () => {
      const placeholders = makePlaceholders();

      const result = renderPlist(TEMPLATE, placeholders);

      expect(result).toContain(
        "<string>/home/user/.local/share/sabori-flow/logs</string>",
      );
    });

    it("同一プレースホルダが複数回出現しても全て展開される", () => {
      const template =
        "__NPX_PATH__ and __NPX_PATH__ and __LOG_DIR__";
      const placeholders = makePlaceholders();

      const result = renderPlist(template, placeholders);

      expect(result).toBe(
        "/usr/local/bin/npx and /usr/local/bin/npx and /home/user/.local/share/sabori-flow/logs",
      );
    });
  });

  describe("二重展開防止: value にプレースホルダ文字列が含まれていても再展開されない", () => {
    it("npxPath に __LOG_DIR__ が含まれていても再展開されない", () => {
      const placeholders = makePlaceholders({
        npxPath: "/path/to/__LOG_DIR__/bin/npx",
      });

      const result = renderPlist(TEMPLATE, placeholders);

      expect(result).toContain(
        "<string>/path/to/__LOG_DIR__/bin/npx</string>",
      );
    });

    it("path に __LOG_DIR__ が含まれていても再展開されない", () => {
      const placeholders = makePlaceholders({
        path: "/usr/bin:__LOG_DIR__:/usr/local/bin",
      });

      const result = renderPlist(TEMPLATE, placeholders);

      expect(result).toContain(
        "<string>/usr/bin:__LOG_DIR__:/usr/local/bin</string>",
      );
    });
  });

  describe("$ 特殊文字: value に正規表現の特殊置換パターンが含まれていても正しく展開される", () => {
    it("value に $1 が含まれていてもそのまま展開される", () => {
      const placeholders = makePlaceholders({
        npxPath: "/path/with/$1/npx",
      });

      const result = renderPlist(TEMPLATE, placeholders);

      expect(result).toContain("<string>/path/with/$1/npx</string>");
    });

    it("value に $& が含まれていてもそのまま展開される", () => {
      const placeholders = makePlaceholders({
        path: "/usr/bin:$&:/usr/local/bin",
      });

      const result = renderPlist(TEMPLATE, placeholders);

      expect(result).toContain(
        "<string>/usr/bin:$&:/usr/local/bin</string>",
      );
    });
  });
});
