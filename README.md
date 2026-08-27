<div align="center">

# AI Control

**Know the moment your AI finishes — even when you're in another app.**

A local-first browser extension for Edge, Chrome and any Chromium browser that watches your **Claude**, **ChatGPT** and **Gemini** tabs and tells you when a task actually completes, when one needs your attention, and how much of your quota is left.

[![License: MIT](https://img.shields.io/badge/License-MIT-c45a1a.svg)](LICENSE)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-2b6cb0)
![Tests](https://img.shields.io/badge/tests-133%20passing-2f855a)
![No dependencies](https://img.shields.io/badge/dependencies-none-555)

[Install](#install) · [How detection works](#how-detection-works) · [Usage panel](#usage-panel) · [Phone alerts](#phone-alerts) · [Privacy](#privacy)

**English** · [Español](README.es.md)

</div>

---

## Why

You give an AI a long job — analyse a repo, refactor a module, research something — and then you go do other things. Ten minutes later you tab back and find it finished nine minutes ago. Or worse: it stopped after thirty seconds waiting for a permission you never saw.

AI Control watches the tabs for you.

- 🔔 **"Claude finished" / "ChatGPT finished" / "Gemini finished"** — fires when the task is *actually* done, not during a pause between tool calls. **Each AI has its own sound**, so you know which one without looking.
- ⚠️ **"… needs your attention"** — a different alert (different tone, doesn't auto-dismiss) for permissions, confirmations, errors or an expired session.
- 📊 **Usage panel** — Claude's 5-hour and weekly windows, ChatGPT's Work/Codex quota, Gemini's current and weekly limits.
- 🔢 **At-a-glance badge** — red = waiting on you, green = finished and unseen, orange = still working.
- 📱 **Optional phone alerts** — via [ntfy](https://ntfy.sh), including a fully local LAN setup that never touches the internet.
- 🌍 **Six languages** — English, Spanish, Portuguese (BR), French, German, Italian. Detection is multilingual too, not just the UI.

Everything stays in your browser. No accounts, no analytics, no servers.

## How detection works

Most "notify me when the AI finishes" extensions watch for the stop button to disappear and fire immediately. That breaks the moment the AI does anything interesting: generate → run a tool → think → generate → finish. Every gap looks like completion.

AI Control combines three independent signal sources and lets a state machine with **hysteresis** make the call:

```
NETWORK (webRequest)     DOM (per-provider probes)     CONTENT
in-flight requests       streaming, stop button,       last message
per tab                  tool indicators, dialogs      still growing
        \                        |                        /
         \_______________________|_______________________/
                                 ▼
                       one ActivitySnapshot
                                 ▼
                        state machine (authority)
                                 ▼
                   SETTLING → (4s stable) → COMPLETED
```

**A finished network request never completes a task by itself.** It's evidence, not a transition:

```
request finishes
    ↓  stop button / streaming visible?  → yes → keep GENERATING
    ↓  a tool still running?             → yes → TOOL_RUNNING
    ↓  content still growing?            → yes → GENERATING
    ↓  another request in flight?        → yes → GENERATING
    ↓  everything quiet → SETTLING → (4s) → COMPLETED ✔
```

Other guarantees, all covered by unit tests: an in-flight request *can* start a task (it's the earliest signal); tool indicators sustain a task but never start one, so a stray spinner can't create a phantom; tasks shorter than 1.5 s are discarded as DOM flicker; losing connectivity **suspends** the machine so a dropped connection is never mistaken for a finished task; and if a network pattern ever stops matching, detection degrades cleanly to DOM-only.

## Install

Not on the Web Store. Load it unpacked — takes a minute:

1. **[Download the latest release](../../releases)** and unzip to a **permanent** folder (moving or deleting it later disables the extension).
2. Open `edge://extensions` (or `chrome://extensions`).
3. Turn on **Developer mode**.
4. **Load unpacked** → select the folder containing `manifest.json`.
5. Pin the extension so you can see the badge.

> **Windows:** if notifications don't show up, check Settings → System → **Notifications**: your browser must be allowed, and **Focus assist** must not be silencing banners while you're in a full-screen app.

## Usage panel

| Provider | Source | What you get |
|---|---|---|
| **Claude** | `claude.ai` usage API | 5-hour + weekly, with reset times |
| **ChatGPT** | `backend-api/wham/usage` | **Work/Codex quota only** + credits — labelled as such, never presented as your whole ChatGPT usage |
| **Gemini** | `gemini.google.com/usage` | Current + weekly limits |

All three are private endpoints with no public contract. AI Control validates the response shape, keeps the last known good value and marks it `stale` rather than showing a made-up number, and a failure in any of them never affects task monitoring.

**Gemini needs an open Gemini tab.** That page renders its percentages with JavaScript, so a plain fetch returns an empty shell. AI Control reads it through a hidden same-origin iframe inside a tab you already have open — which also means it automatically uses the right account if you're signed into several Google accounts. See [docs/USAGE-SOURCES.md](docs/USAGE-SOURCES.md).

If a provider shows *"not published"*, that's usually correct rather than a bug: ChatGPT only exposes the Work/Codex quota, and Gemini's usage page doesn't exist on every plan.

## Phone alerts

Off by default. Two modes, both documented step by step in **[docs/PHONE-SETUP.md](docs/PHONE-SETUP.md)**:

- **ntfy.sh** — install the ntfy app, generate a topic, subscribe. Three minutes.
- **Your own LAN server** — run the ntfy binary on your PC; alerts go PC → router → phone and never touch the internet. The guide covers the firewall rule, the DHCP reservation, the `manifest.json` entry for your local IP, **Windows autostart via Task Scheduler**, and a troubleshooting table.

> Android only for LAN mode: iOS blocks the persistent background connection it needs.

## Privacy

Local-first is the architecture, not a slogan:

- Conversation **content** is never read, stored or transmitted. The extension sees state signals and the tab title, nothing else.
- No analytics, no telemetry, no crash reporting, no servers of our own.
- Network requests, in full: the usage endpoints above (authenticated by your existing browser session) and the ntfy `POST` **only if you turn phone alerts on**.
- ChatGPT's usage endpoint sometimes needs a bearer token. It's fetched on demand and **kept in memory only** — never written to storage. There's a test asserting it never lands on disk.
- History stores metadata only — provider, title, timings, outcome — capped at 200 entries, exportable and erasable.

See [docs/PRIVACY.md](docs/PRIVACY.md) and [docs/PERMISSIONS.md](docs/PERMISSIONS.md), where every permission is justified individually.

## Tests

```bash
npm test     # 133 tests, plain Node, no dependencies, no browser
```

Covers the state machine (including the full `generate → tool → pause → generate → finish` timeline), the hybrid network+DOM detector, the multi-tab registry, notification grouping and click routing, all three usage adapters with real response fixtures plus 401/403/429/offline/stale/shape-changed cases, and locale integrity.

Browser-dependent checks are scripted in [docs/TESTING.md](docs/TESTING.md).

## Contributing

Adding a language is one JSON file plus one array entry — see [CONTRIBUTING.md](CONTRIBUTING.md). `node tests/test-i18n.js` fails if any locale is missing a key or breaks a placeholder.

If detection breaks after a provider redesigns its UI, everything you need to edit lives in `content/detector.js` under `PROVIDERS`. [docs/FRAGILITY.md](docs/FRAGILITY.md) maps each fragile point to the exact thing to change.

## Known limitations

Honest ones, in [docs/LIMITATIONS.md](docs/LIMITATIONS.md). Short version: detection depends on each provider's DOM and endpoints, which can change without notice; the "finished" alert is deliberately ~4 s late to avoid false positives; usage sources are private APIs; Gemini usage needs an open tab; PWA windows are out of scope.

## Credits

Built from scratch after auditing a dozen existing extensions — [docs/LICENSES.md](docs/LICENSES.md) records what was studied and why no code was copied. Sounds and icons are generated, not borrowed.

MIT licensed. Not affiliated with Anthropic, OpenAI or Google.
