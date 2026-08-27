# Changelog

## 3.4.0
- **Pick your AIs.** The per-provider toggles in Options now actually govern
  everything: a disabled AI stops being monitored, its tabs release their
  observers, its usage endpoints are never queried, and its block disappears
  from the popup. If you only use one, the UI looks like it was built for it.

## 3.3.0
- **Gemini usage now works**: the page renders its values with JavaScript, so a
  plain fetch saw nothing. Reads it through a hidden same-origin iframe in an
  open Gemini tab (inherits the right Google account automatically).
- Usage parser is multilingual — it was matching only English ("used",
  "weekly"), so it failed for anyone using Gemini in another language.
- Multi-account support: manual account index or auto-detection from open tabs.

## 3.2.0
- Hybrid detection: `webRequest` signals feed the state machine as **evidence**.
  A finished request never completes a task on its own.
- Usage panel for all three providers behind one shared contract.
- ChatGPT Work/Codex quota via `wham/usage`, labelled so it's never mistaken
  for total ChatGPT usage.

## 2.1.0
- Rebranded to **AI Control**: the UI no longer looks Claude-only.
- Provider colours separated from state colours; unified task list.

## 2.0.0
- **Multi-AI**: ChatGPT and Gemini alongside Claude, each with its own sound.

## 1.3.0
- Six languages via `chrome.i18n`, including multilingual detection.

## 1.2.x
- Optional phone alerts via ntfy, including a LAN-only mode.
- Fixed: accented characters in notification headers broke `fetch`.

## 1.0.0
- First release: hysteresis state machine, multi-tab registry, notifications
  with grouping, sounds, badge, usage monitor, popup, options, history.
