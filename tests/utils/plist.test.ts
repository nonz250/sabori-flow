import { describe, it, expect } from "vitest";
import { renderPlist } from "../../src/utils/plist.js";
import type { PlistPlaceholders } from "../../src/utils/plist.js";

// ---------- Helpers ----------

function makePlaceholders(
  overrides?: Partial<PlistPlaceholders>,
): PlistPlaceholders {
  return {
    nodePath: "/usr/local/bin/node",
    projectRoot: "/home/user/project",
    path: "/usr/local/bin:/usr/bin:/bin",
    logDir: "/home/user/.local/share/sabori-flow/logs",
    ...overrides,
  };
}

const TEMPLATE = [
  "<string>__NODE_PATH__</string>",
  "<string>__PROJECT_ROOT__</string>",
  "<string>__PATH__</string>",
  "<string>__LOG_DIR__</string>",
].join("\n");

// ---------- Tests ----------

describe("renderPlist", () => {
  describe("正常系: 各プレースホルダが正しく展開される", () => {
    it("__NODE_PATH__ が nodePath の値に展開される", () => {
      const placeholders = makePlaceholders();

      const result = renderPlist(TEMPLATE, placeholders);

      expect(result).toContain("<string>/usr/local/bin/node</string>");
    });

    it("__PROJECT_ROOT__ が projectRoot の値に展開される", () => {
      const placeholders = makePlaceholders();

      const result = renderPlist(TEMPLATE, placeholders);

      expect(result).toContain("<string>/home/user/project</string>");
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
        "__NODE_PATH__ and __NODE_PATH__ and __PROJECT_ROOT__";
      const placeholders = makePlaceholders();

      const result = renderPlist(template, placeholders);

      expect(result).toBe(
        "/usr/local/bin/node and /usr/local/bin/node and /home/user/project",
      );
    });
  });

  describe("二重展開防止: value にプレースホルダ文字列が含まれていても再展開されない", () => {
    it("nodePath に __PROJECT_ROOT__ が含まれていても再展開されない", () => {
      const placeholders = makePlaceholders({
        nodePath: "/path/to/__PROJECT_ROOT__/bin/node",
      });

      const result = renderPlist(TEMPLATE, placeholders);

      expect(result).toContain(
        "<string>/path/to/__PROJECT_ROOT__/bin/node</string>",
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
        nodePath: "/path/with/$1/node",
      });

      const result = renderPlist(TEMPLATE, placeholders);

      expect(result).toContain("<string>/path/with/$1/node</string>");
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
