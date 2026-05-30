# oc-free 🆓

**OpenCode plugin** — discover and use free AI model providers directly from
your OpenCode CLI/TUI.

<p align="center">
  <img src="https://img.shields.io/badge/opencode-plugin-blue?style=flat-square" alt="OpenCode Plugin">
  <img src="https://img.shields.io/npm/v/oc-free?style=flat-square" alt="npm">
  <img src="https://img.shields.io/github/license/wwwbkgme-oss/oc-free?style=flat-square" alt="MIT">
</p>

---

## ✨ Features

| Provider    | Models                         | Auth                | Rate limit              |
| ----------- | ------------------------------ | ------------------- | ----------------------- |
| **opencode** | big-pickle, nemotron, trinity, minimax, mimo, deepseek | None | — |
| **openrouter** | Qwen3 Coder, DeepSeek V3.2, Gemini 3.1 Flash, Mistral Small 4, o4-mini | `OPENROUTER_API_KEY` | — |
| **kilo**    | Llama 3.3 70B, Qwen3 Coder 32B, DeepSeek V3.2, GLM-4.7, Mistral Small 3.1, Phi-4 Mini | OAuth (free) | — |
| **llm7**    | Default, Fast                  | `LLM7_API_KEY`      | 100 req/hr              |
| **cline**   | Claude Sonnet 4, Claude Haiku 3.5 | Free account     | — |
| **qwen**    | Qwen3 Coder 32B, Qwen3 Plus    | OAuth (1000 req/day) | 1000 req/day |

- Auto-configures each provider's `baseUrl` and `models` so they work out of
  the box.
- **`/free`** — **Live health check**: tests API keys, probes endpoints, shows which providers are actually ready to use (with response times).
- `/free-models` — list all discovered models grouped by provider.
- `/free-status` — quick counts of free vs paid models.
- `/toggle-free` — switch between free-only and all-models view.
- `/toggle-{provider}` — show/hide paid models for a single provider.
- `/free-hide <model-id>` — permanently hide a model from listings.
- `/free-unhide <model-id>` — restore a hidden model.
- `/free-hidden` — list all hidden model IDs.
- A `free_models` tool that the AI can call autonomously.

---

## 📦 Installation

### Via npm (recommended)

Add `oc-free` to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["oc-free"]
}
```

Restart OpenCode. The plugin is downloaded and cached automatically by Bun.

### Local installation (no npm)

Clone and build:

```bash
git clone https://github.com/wwwbkgme-oss/oc-free.git
cd oc-free
bun install
bun run build
```

Then copy `dist/index.js` to your OpenCode plugin directory:

```bash
mkdir -p ~/.config/opencode/plugins
cp dist/index.js ~/.config/opencode/plugins/oc-free.js
```

Restart OpenCode.

---

## 🚀 Usage

### Commands

| Command                   | Description                                      |
| ------------------------- | ------------------------------------------------ |
| `/free`                   | **Live health check** — tests keys + endpoints   |
| `/free-models`            | List all free models across every provider        |
| `/free-status`            | Show provider-wise free/paid model counts         |
| `/toggle-free`            | Toggle global free-only mode on/off               |
| `/toggle-{provider}`      | Toggle paid models for a specific provider        |
| `/free-hide <model-id>`   | Hide a model from output                          |
| `/free-unhide <model-id>` | Restore a hidden model                            |
| `/free-hidden`            | List hidden model IDs                             |

### Tool

The AI can also discover models by calling the `free_models` tool.

### Provider API keys

Some providers require an environment variable:

```bash
export OPENROUTER_API_KEY="sk-or-..."
export LLM7_API_KEY="..."
```

Others (kilo, cline, qwen) use OAuth / free accounts with no key needed.

---

## 🔧 Configuration

The plugin stores its state in `~/.config/oc-free/config.json`:

```json
{
  "free_only": true,
  "hidden_models": ["opencode/old-model"]
}
```

You can edit this file directly, but the slash-commands are usually easier.

---

## 🧑‍💻 Development

```bash
git clone https://github.com/wwwbkgme-oss/oc-free.git
cd oc-free
bun install

# Build
bun run build

# Type-check
bun run typecheck
```

The plugin is a single TypeScript file (`src/index.ts`). It uses no external
dependencies at runtime other than `@opencode-ai/plugin`.

---

## 📄 License

MIT — see [LICENSE](LICENSE).
