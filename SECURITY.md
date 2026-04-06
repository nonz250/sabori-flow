# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | :white_check_mark: |
| < 0.2.0 | :x:                |

## Reporting a Vulnerability

**Please do not open public issues for security vulnerabilities.**

To report a vulnerability, use [GitHub Security Advisories](https://github.com/nonz250/sabori-flow/security/advisories/new) (the "Report a vulnerability" button on the Security tab). This ensures that the report remains private until a fix is available.

### What to Include

- A description of the vulnerability
- Steps to reproduce or a proof of concept
- The potential impact
- Any suggested fix (optional)

## Expected Response Timeline

- **Acknowledgment**: Within 48 hours of the report
- **Initial assessment**: Within 7 days
- **Target fix**: Within 30 days, depending on severity and complexity

These timelines are best-effort targets. Complex issues may require additional time.

## Scope

The following areas are considered in scope for security reports:

- **Prompt injection**: Malicious Issue content influencing Claude CLI behavior beyond intended scope
- **Secret/credential leakage**: Tokens, keys, or sensitive data exposed in output, logs, or comments
- **Command injection**: Exploitation of child_process execution (e.g., via `gh` or `git` commands)
- **Unauthorized file system access**: Abuse of worktree operations to read or write outside intended directories
- **Configuration tampering**: Manipulation of `config.yml` to cause unintended behavior

### Out of Scope

- Vulnerabilities in third-party dependencies (please report these upstream)
- Vulnerabilities in Claude Code CLI itself (please report to [Anthropic](https://www.anthropic.com))
- Issues that require physical access to the machine running sabori-flow

## Disclosure Policy

We follow coordinated disclosure practices:

- Vulnerability details will not be published until a fix is available
- Credit will be given to reporters in the release notes (unless they prefer to remain anonymous)
- We aim to coordinate disclosure timelines with the reporter
