import { describe, it, expect } from "vitest";

import { isUsageLimitReached } from "../../src/worker/usage-limit.js";
import { Agent } from "../../src/worker/models.js";

function output(stdout: string, stderr = "") {
  return { success: false, stdout, stderr };
}

describe("isUsageLimitReached", () => {
  describe("Claude Code CLI", () => {
    it.each([
      ["5 時間枠の上限", "You've hit your session limit · resets 3pm (Asia/Tokyo)"],
      ["週次の上限", "You've hit your weekly limit · resets Mon 9am"],
      ["月次の利用額上限", "You've hit your monthly spend limit."],
      ["チームの共有予算", "You've hit your team's shared budget. Switch to another model"],
      ["旧形式の上限メッセージ", "Claude AI usage limit reached|1760000000"],
      ["usage credits の枯渇", "You're out of usage credits. Switch to another model"],
      ["extra usage の枯渇", "You're out of extra usage"],
      ["組織のクレジット枯渇", "Your organization is out of usage credits. Contact your admin to add more."],
      ["API キーの残高不足", "Credit balance is too low"],
    ])("%s を検出する", (_name, message) => {
      expect(isUsageLimitReached(Agent.CLAUDE, output(message))).toBe(true);
    });

    it("stderr に出たメッセージも検出する", () => {
      expect(isUsageLimitReached(Agent.CLAUDE, output("", "Credit balance is too low"))).toBe(true);
    });

    it("曲がった引用符のアポストロフィでも検出する", () => {
      expect(isUsageLimitReached(Agent.CLAUDE, output("You’ve hit your session limit"))).toBe(true);
    });

    it.each([
      ["一般的な実行エラー", "Error: tool execution failed"],
      ["一時的なレート制限", "API Error: 429 rate_limit_error"],
      ["空出力", ""],
    ])("%s は上限扱いしない", (_name, message) => {
      expect(isUsageLimitReached(Agent.CLAUDE, output(message, message))).toBe(false);
    });
  });

  describe("Codex CLI", () => {
    it.each([
      ["プランの上限", "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), or try again later."],
      ["上限到達の短い形式", "Usage limit reached. You've reached your usage limit."],
      ["ワークスペースのクレジット枯渇", "Your workspace is out of credits. Add credits to continue."],
      ["API のクォータ超過", "Quota exceeded. Check your plan and billing details."],
      ["エラーコード usage_limit_reached", "stream error: usage_limit_reached"],
      ["エラーコード insufficient_quota", "error code: insufficient_quota"],
    ])("%s を検出する", (_name, message) => {
      expect(isUsageLimitReached(Agent.CODEX, output("", message))).toBe(true);
    });

    it.each([
      ["一般的な実行エラー", "Error: sandbox denied"],
      ["一時的なレート制限", "rate_limit_exceeded"],
      ["空出力", ""],
    ])("%s は上限扱いしない", (_name, message) => {
      expect(isUsageLimitReached(Agent.CODEX, output(message, message))).toBe(false);
    });
  });

  describe("出力の末尾だけを照合する", () => {
    it("Codex の stderr の途中に Issue 本文由来の文言があっても、末尾が別のエラーなら上限扱いしない", () => {
      const transcript = [
        "exec gh issue view 42",
        "Body: our API returns 'quota exceeded' when usage limit reached",
        "thinking...",
        "running npm test",
        "npm test failed",
        "ERROR: command exited with code 1",
      ].join("\n");

      expect(isUsageLimitReached(Agent.CODEX, output("", transcript))).toBe(false);
    });

    it("Codex の stderr の末尾に上限エラーがあれば、前に会話ログがあっても検出する", () => {
      const transcript = [
        "exec gh issue view 42",
        "running npm test",
        "ERROR: You've hit your usage limit. Try again later.",
        "",
      ].join("\n");

      expect(isUsageLimitReached(Agent.CODEX, output("", transcript))).toBe(true);
    });
  });

  describe("正常終了した実行", () => {
    it("stdout 全体が上限メッセージ 1 行だけなら検出する", () => {
      const result = { success: true, stdout: "Claude AI usage limit reached|1760000000\n", stderr: "" };

      expect(isUsageLimitReached(Agent.CLAUDE, result)).toBe(true);
    });

    it("上限の文言がモデル出力の一部として含まれるだけなら検出しない", () => {
      const result = {
        success: true,
        stdout: "Plan:\n1. Handle the case where the API says usage limit reached",
        stderr: "",
      };

      expect(isUsageLimitReached(Agent.CLAUDE, result)).toBe(false);
    });

    it("stderr に上限の文言があっても stdout が通常の出力なら検出しない", () => {
      const result = { success: true, stdout: "done", stderr: "You've hit your usage limit." };

      expect(isUsageLimitReached(Agent.CODEX, result)).toBe(false);
    });
  });
});
