# Contributing

Thanks for helping! A few things that make review easy.

## Before a PR
```bash
npm test      # 133 tests, plain Node, no dependencies, no browser
```
All tests must pass.

## Where things live
| Path | What it is |
|---|---|
| `content/detector.js` | **The only file that knows each provider's DOM.** If Claude/ChatGPT/Gemini redesign their UI and detection breaks, edit `PROVIDERS` here. See `docs/FRAGILITY.md`. |
| `content/state-machine.js` | Pure FSM: `(state, signals, now) → state'`. No DOM, no `chrome.*`. Fully unit-tested. |
| `background/network-signals.js` | webRequest patterns per provider. Emits evidence, never decisions. |
| `background/usage-adapters.js` | Converts each provider's response into the shared usage contract. |
| `background/*.js` | Factories with injected dependencies, so they're testable in Node. |
| `_locales/<lang>/messages.json` | Translations. |

## Adding a language
1. Copy `_locales/en/messages.json` to `_locales/<code>/messages.json`
   (`es`, `pt_BR`, `fr`, `de`, `it`, `ja`, …).
2. Translate every `message`. Leave `$PLACEHOLDERS$` untouched.
3. **Important:** add your language's word for the Stop button to `STOP_WORDS`
   in `content/detector.js`, and the word for "used"/"weekly" to the Gemini
   parser in `background/usage-adapters.js`. Without this the UI is translated
   but detection won't work in that language.
4. Run `node tests/test-i18n.js`.

## Adding a provider
1. Add an entry to `PROVIDERS` in `content/detector.js` (hosts, probes, title suffix).
2. Add its network patterns to `NETWORK_PATTERNS` in `background/network-signals.js`.
3. If it exposes usage, write an adapter in `background/usage-adapters.js` that
   returns the shared contract, plus fixtures in `tests/test-usage-adapters.js`.
4. Add `matches` and `host_permissions` entries in `manifest.json`.
5. Add a colour token in `shared/tokens.css` and a pill class.

## Rules of the house
- No build step, no bundler, no dependencies.
- New behaviour needs a test.
- **Never present an estimate as official data.** If a provider doesn't publish
  a number, show "not published" rather than inventing one.
- Keep it local-first: no analytics, no telemetry, no servers beyond the
  documented opt-in ntfy alert.
- Never persist tokens, cookies, prompts or responses.
