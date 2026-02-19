# ⚠️ This is a Fork

This repository is a **fork** of [nanobot](https://github.com/HKUDS/nanobot).

**Please use the original project instead:**
- 🐈 [https://github.com/HKUDS/nanobot](https://github.com/HKUDS/nanobot)

---

## Why This Fork Exists

*Personal notes for Umar Alfarouk's development purposes.*

---

## Fork-Specific Features

**WhatsApp Enhancement**: This fork adds group mention detection and per-group quiz system (Kotaete).

- Bot responds only when mentioned in groups
- Custom quizzes per group with answer matching (exact → ✅, partial → ✨, close → 🔍)
- See `bridge/KOTAETE.md` and `AGENTS.md` for details

---

## Upstream Updates (v0.1.4)

- **2026-02-16** 🦞 nanobot now integrates a [ClawHub](https://clawhub.ai) skill — search and install public agent skills.
- **2026-02-15** 🔑 nanobot now supports OpenAI Codex provider with OAuth login support.
- **2026-02-14** 🔌 nanobot now supports MCP! See [upstream docs](https://github.com/HKUDS/nanobot#mcp-model-context-protocol) for details.
- **2026-02-13** 🎉 Released v0.1.3.post7 — includes security hardening and multiple improvements. All users are recommended to upgrade. See [upstream release notes](https://github.com/HKUDS/nanobot/releases/tag/v0.1.3.post7) for more details.

📏 Core agent: **3,761 lines** (run `bash core_agent_lines.sh` to verify anytime)
