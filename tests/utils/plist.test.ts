import { describe, it, expect } from "vitest";
import { renderPlist } from "../../src/utils/plist.js";
import type { PlistPlaceholders } from "../../src/utils/plist.js";

// ---------- Helpers ----------

function makePlaceholders(
  overrides?: Partial<PlistPlaceholders>,
): PlistPlaceholders {
  return {
    programArguments: ["/usr/local/bin/npx", "sabori-flow", "worker"],
    path: "/usr/local/bin:/usr/bin:/bin",
    logDir: "/home/user/.local/share/sabori-flow/logs",
    ...overrides,
  };
}

const TEMPLATE = [
  "<key>ProgramArguments</key>",
  "__PROGRAM_ARGUMENTS__",
  "<string>__PATH__</string>",
  "<string>__LOG_DIR__</string>",
].join("\n");

// ---------- Tests ----------

describe("renderPlist", () => {
  describe("正常系: 各プレースホルダが正しく展開される", () => {
    it("__PROGRAM_ARGUMENTS__ が programArguments の XML に展開される", () => {
      const placeholders = makePlaceholders();

      const result = renderPlist(TEMPLATE, placeholders);

      expect(result).toContain("<array>");
      expect(result).toContain("    <string>/usr/local/bin/npx</string>");
      expect(result).toContain("    <string>sabori-flow</string>");
      expect(result).toContain("    <string>worker</string>");
      expect(result).toContain("</array>");
    });

    it("単一要素の programArguments でも正しく展開される", () => {
      const placeholders = makePlaceholders({
        programArguments: ["/usr/local/bin/node"],
      });

      const result = renderPlist(TEMPLATE, placeholders);

      expect(result).toContain("<array>");
      expect(result).toContain("    <string>/usr/local/bin/node</string>");
      expect(result).toContain("</array>");
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
        "__LOG_DIR__ and __LOG_DIR__ and __PATH__";
      const placeholders = makePlaceholders();

      const result = renderPlist(template, placeholders);

      expect(result).toBe(
        "/home/user/.local/share/sabori-flow/logs and /home/user/.local/share/sabori-flow/logs and /usr/local/bin:/usr/bin:/bin",
      );
    });
  });

  describe("二重展開防止: value にプレースホルダ文字列が含まれていても再展開されない", () => {
    it("programArguments に __LOG_DIR__ が含まれていても再展開されない", () => {
      const placeholders = makePlaceholders({
        programArguments: ["/path/to/__LOG_DIR__/bin/npx", "sabori-flow", "worker"],
      });

      const result = renderPlist(TEMPLATE, placeholders);

      expect(result).toContain(
        "    <string>/path/to/__LOG_DIR__/bin/npx</string>",
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

  describe("XML エスケープ: 特殊文字が正しくエスケープされる", () => {
    it("programArguments 内の &, <, > がエスケープされる", () => {
      const placeholders = makePlaceholders({
        programArguments: ["/path/with&ampersand", "arg<with>brackets"],
      });

      const result = renderPlist(TEMPLATE, placeholders);

      expect(result).toContain(
        "    <string>/path/with&amp;ampersand</string>",
      );
      expect(result).toContain(
        "    <string>arg&lt;with&gt;brackets</string>",
      );
    });

    it("path 内の &, <, > がエスケープされる", () => {
      const placeholders = makePlaceholders({
        path: "/usr/bin&test</path>",
      });

      const result = renderPlist(TEMPLATE, placeholders);

      expect(result).toContain(
        "<string>/usr/bin&amp;test&lt;/path&gt;</string>",
      );
    });

    it("logDir 内の &, <, > がエスケープされる", () => {
      const placeholders = makePlaceholders({
        logDir: "/logs/<dir>&name",
      });

      const result = renderPlist(TEMPLATE, placeholders);

      expect(result).toContain(
        "<string>/logs/&lt;dir&gt;&amp;name</string>",
      );
    });

    it("引用符もエスケープされる", () => {
      const placeholders = makePlaceholders({
        programArguments: [`arg"with'quotes`],
      });

      const result = renderPlist(TEMPLATE, placeholders);

      expect(result).toContain(
        "    <string>arg&quot;with&apos;quotes</string>",
      );
    });
  });

  describe("$ 特殊文字: value に正規表現の特殊置換パターンが含まれていても正しく展開される", () => {
    it("value に $1 が含まれていてもそのまま展開される", () => {
      const placeholders = makePlaceholders({
        programArguments: ["/path/with/$1/npx", "sabori-flow", "worker"],
      });

      const result = renderPlist(TEMPLATE, placeholders);

      expect(result).toContain("    <string>/path/with/$1/npx</string>");
    });

    it("value に $& が含まれていてもそのまま展開される（& は XML エスケープされる）", () => {
      const placeholders = makePlaceholders({
        path: "/usr/bin:$&:/usr/local/bin",
      });

      const result = renderPlist(TEMPLATE, placeholders);

      expect(result).toContain(
        "<string>/usr/bin:$&amp;:/usr/local/bin</string>",
      );
    });
  });
});
