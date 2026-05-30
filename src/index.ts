import { tool } from '@opencode-ai/plugin';
import { readFileSync, existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

const z = tool.schema;

// ---------------------------------------------------------------------------
// Config paths
// ---------------------------------------------------------------------------
const HOME = process.env.HOME || process.env.USERPROFILE || '';
const OC_FREE_DIR = join(HOME, '.config', 'oc-free');
const CONFIG_PATH = join(OC_FREE_DIR, 'config.json');
const SECRETS_PATH = join(OC_FREE_DIR, 'secrets.json');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface OcFreeConfig {
  free_only?: boolean;
  kilo_show_paid?: boolean;
  cline_show_paid?: boolean;
  llm7_show_paid?: boolean;
  openrouter_show_paid?: boolean;
  qwen_show_paid?: boolean;
  hidden_models?: string[];
}

/** Persisted API keys — written by `/free-setup apply`, read by config hook. */
interface SecretsConfig {
  [providerId: string]: {
    apiKey?: string;
    configuredAt?: string;
  };
}

interface HealthResult {
  id: string;
  status: 'ok' | 'no_key' | 'unreachable' | 'error';
  ms: number;
  detail: string;
}

type SetupLevel = 'none' | 'env_key' | 'oauth' | 'builtin' | 'api_key';

interface ProviderEntry {
  id: string;
  free: string[];
  all: string[];
  note: string;
  docs?: string;
  /** The env-var name if the user is expected to set one themselves. */
  envKey?: string;
  /** Human-readable setup level for the onboarding wizard. */
  setup: SetupLevel;
  /** Display name of what is needed (shown in /free-setup). */
  setupLabel: string;
  /** URL where the user can get an API key or sign up. */
  setupUrl?: string;
  /** Extra setup instructions. */
  setupDetail?: string;
  /** Base URL used for connectivity health checks. */
  healthUrl?: string;
  /** Auto-register the provider config so models actually work. */
  configEntry?: (providers: Record<string, unknown>, secrets?: SecretsConfig) => void;
}

// ---------------------------------------------------------------------------
// Secrets persistence
// ---------------------------------------------------------------------------
function loadSecrets(): SecretsConfig {
  try {
    if (!existsSync(SECRETS_PATH)) return {};
    return JSON.parse(readFileSync(SECRETS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveSecret(providerId: string, apiKey: string): void {
  try {
    mkdirSync(OC_FREE_DIR, { recursive: true });
    const existing = loadSecrets();
    existing[providerId] = { apiKey, configuredAt: new Date().toISOString() };
    writeFileSync(SECRETS_PATH, JSON.stringify(existing, null, 2), 'utf8');
    // Protect secrets file
    try { chmodSync(SECRETS_PATH, 0o600); } catch { /* best-effort */ }
    // Also write companion .env file the user can source
    const envLines = Object.entries(existing)
      .filter(([, v]) => v.apiKey)
      .map(([id, v]) => {
        const pv = FREE_PROVIDERS.find(p => p.id === id);
        return pv?.envKey ? `${pv.envKey}="${v.apiKey}"` : `# ${id}: key saved to secrets.json`;
      });
    const envPath = join(OC_FREE_DIR, '.env');
    writeFileSync(envPath, `# oc-free managed secrets — source this or let the plugin handle it\n${envLines.join('\n')}\n`, 'utf8');
  } catch {
    /* best-effort */
  }
}

function hasSecret(providerId: string): boolean {
  const s = loadSecrets();
  return !!s[providerId]?.apiKey;
}

function getSecret(providerId: string): string | undefined {
  return loadSecrets()[providerId]?.apiKey;
}

// ---------------------------------------------------------------------------
// Provider config builders
// ---------------------------------------------------------------------------
function configureKilo(providers: Record<string, unknown>, _secrets?: SecretsConfig) {
  if (providers.kilo) return;
  const models = FREE_PROVIDERS.find(x => x.id === 'kilo')!.free.map(m => [
    m.split('/')[1],
    { name: m.split('/')[1] },
  ]);
  providers.kilo = {
    baseUrl: 'https://api.kilo.ai/api/gateway',
    models: Object.fromEntries(models),
  };
}

function configureLlm7(providers: Record<string, unknown>, secrets?: SecretsConfig) {
  if (providers.llm7) return;
  const cfg: Record<string, unknown> = {
    baseUrl: 'https://api.llm7.io/v1',
    models: { default: { name: 'LLM7 Default' }, fast: { name: 'LLM7 Fast' } },
  };
  const saved = secrets?.llm7?.apiKey;
  if (saved) {
    cfg.options = { apiKey: saved };
  }
  providers.llm7 = cfg;
}

function configureCline(providers: Record<string, unknown>, _secrets?: SecretsConfig) {
  if (providers.cline) return;
  providers.cline = {
    baseUrl: 'https://api.cline.bot/api/v1',
    models: {
      'claude-sonnet-4': { name: 'Claude Sonnet 4' },
      'claude-haiku-3.5': { name: 'Claude Haiku 3.5' },
    },
  };
}

function configureQwen(providers: Record<string, unknown>, _secrets?: SecretsConfig) {
  if (providers.qwen) return;
  providers.qwen = {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: 'oc-free-qwen',
    models: {
      'qwen3-coder-32b': { name: 'Qwen3 Coder 32B' },
      'qwen3-plus': { name: 'Qwen3 Plus' },
    },
  };
}

function configureOpenrouter(providers: Record<string, unknown>, secrets?: SecretsConfig) {
  if (providers.openrouter) return;
  const models = FREE_PROVIDERS.find(x => x.id === 'openrouter')!.free.map(m => {
    const key = m.replace(/^openrouter\//, '');
    return [key, { name: key }];
  });
  const cfg: Record<string, unknown> = {
    baseUrl: 'https://openrouter.ai/api/v1',
    models: Object.fromEntries(models),
  };
  const saved = secrets?.openrouter?.apiKey;
  if (saved) {
    cfg.options = { apiKey: saved };
  }
  providers.openrouter = cfg;
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------
const FREE_PROVIDERS: ProviderEntry[] = [
  {
    id: 'opencode',
    free: [
      'opencode/big-pickle',
      'opencode/nemotron-3-super-free',
      'opencode/trinity-large-preview-free',
      'opencode/minimax-m2.5-free',
      'opencode/mimo-v2-pro-free',
      'opencode/mimo-v2-omni-free',
      'opencode/mimo-v2-flash-free',
      'opencode/deepseek-v4-flash-free',
      'opencode/mimo-v2.5-free',
    ],
    all: [],
    note: 'No setup required',
    docs: 'https://opencode.ai/docs/zen',
    setup: 'builtin',
    setupLabel: 'Built-in — no key needed',
  },
  {
    id: 'openrouter',
    free: [
      'openrouter/qwen/qwen3-coder:free',
      'openrouter/deepseek/deepseek-v3.2:free',
      'openrouter/google/gemini-3.1-flash:free',
      'openrouter/mistralai/mistral-small-4:free',
      'openrouter/openai/o4-mini:free',
    ],
    all: [],
    note: 'Set OPENROUTER_API_KEY env var',
    envKey: 'OPENROUTER_API_KEY',
    docs: 'https://openrouter.ai/keys',
    setup: 'api_key',
    setupLabel: 'API key required',
    setupUrl: 'https://openrouter.ai/keys',
    setupDetail:
      '1. Go to https://openrouter.ai/keys\n2. Sign up / log in\n3. Create a free API key\n4. Run: `/free-setup apply openrouter <your-key>`',
    healthUrl: 'https://openrouter.ai/api/v1/models',
    configEntry: configureOpenrouter,
  },
  {
    id: 'kilo',
    free: [
      'kilo/llama-3.3-70b',
      'kilo/qwen3-coder-32b',
      'kilo/deepseek-v3.2',
      'kilo/glm-4.7',
      'kilo/mistral-small-3.1',
      'kilo/phi-4-mini',
    ],
    all: [],
    note: 'Free OAuth, no credit card',
    docs: 'https://kilo.chat',
    setup: 'oauth',
    setupLabel: 'OAuth (free) — no key needed',
    setupUrl: 'https://kilo.chat',
    setupDetail:
      '1. Go to https://kilo.chat\n2. Sign up for a free account (OAuth via GitHub/Google)\n3. OpenCode will use OAuth automatically — no API key required',
    healthUrl: 'https://api.kilo.ai/api/gateway',
    configEntry: configureKilo,
  },
  {
    id: 'llm7',
    free: ['llm7/default', 'llm7/fast'],
    all: [],
    note: '100 req/hr free tier',
    envKey: 'LLM7_API_KEY',
    docs: 'https://token.llm7.io',
    setup: 'api_key',
    setupLabel: 'API key required',
    setupUrl: 'https://token.llm7.io',
    setupDetail:
      '1. Go to https://token.llm7.io\n2. Sign up for an account\n3. Generate an API token\n4. Run: `/free-setup apply llm7 <your-token>`',
    healthUrl: 'https://api.llm7.io/v1',
    configEntry: configureLlm7,
  },
  {
    id: 'cline',
    free: ['cline/claude-sonnet-4', 'cline/claude-haiku-3.5'],
    all: [],
    note: 'Free account, no credit card',
    docs: 'https://cline.bot',
    setup: 'oauth',
    setupLabel: 'Free account — no key needed',
    setupUrl: 'https://cline.bot',
    setupDetail:
      '1. Go to https://cline.bot\n2. Create a free account\n3. OpenCode will handle auth automatically — no manual API key required',
    healthUrl: 'https://api.cline.bot/api/v1',
    configEntry: configureCline,
  },
  {
    id: 'qwen',
    free: ['qwen/qwen3-coder-32b', 'qwen/qwen3-plus'],
    all: [],
    note: '1000 free req/day via OAuth',
    docs: 'https://chat.qwen.ai',
    setup: 'oauth',
    setupLabel: 'OAuth (1000 req/day) — no key needed',
    setupUrl: 'https://chat.qwen.ai',
    setupDetail:
      '1. Go to https://chat.qwen.ai\n2. Sign up for a free Alibaba Cloud / Qwen account\n3. OAuth is handled automatically — no manual API key required',
    healthUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    configEntry: configureQwen,
  },
];

// ---------------------------------------------------------------------------
// Config persistence
// ---------------------------------------------------------------------------
function loadConfig(): OcFreeConfig {
  try {
    if (!existsSync(CONFIG_PATH)) return { free_only: true, hidden_models: [] };
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { free_only: true, hidden_models: [] };
  }
}

function saveConfig(updates: Partial<OcFreeConfig>): void {
  try {
    mkdirSync(OC_FREE_DIR, { recursive: true });
    const existing = loadConfig();
    writeFileSync(CONFIG_PATH, JSON.stringify({ ...existing, ...updates }, null, 2), 'utf8');
  } catch {
    /* best-effort */
  }
}

function isFreeOnly(): boolean {
  return loadConfig().free_only ?? true;
}

function getShowPaid(id: string): boolean {
  const cfg = loadConfig();
  return !!(cfg as Record<string, boolean | undefined>)[`${id}_show_paid`];
}

function visibleModels(pv: ProviderEntry): string[] {
  const cfg = loadConfig();
  const hidden = new Set(cfg.hidden_models ?? []);
  const showPaid = getShowPaid(pv.id);
  const pool = isFreeOnly() || !showPaid ? pv.free : [...pv.free, ...pv.all];
  return pool.filter(m => !hidden.has(m));
}

/** Shorthand to build a text-only part (IDs are filled in by the host). */
function textPart(text: string) {
  return { type: 'text' as const, text };
}

/** Icon for setup level shown in onboarding. */
function setupIcon(setup: SetupLevel): string {
  switch (setup) {
    case 'builtin': return '🔵';
    case 'oauth': return '🟢';
    case 'api_key': return '🟡';
    case 'env_key': return '🟡';
    case 'none': return '⚪';
  }
}

function keyStatus(pv: ProviderEntry): { icon: string; label: string } {
  // 1) secrets.json has key
  if (hasSecret(pv.id)) return { icon: '✅', label: 'Key saved via /free-setup' };
  // 2) env var is set
  if (pv.envKey && process.env[pv.envKey]) return { icon: '✅', label: `\`${pv.envKey}\` is set` };
  // 3) needs env key but not set
  if (pv.envKey) return { icon: '❌', label: `\`${pv.envKey}\` not set` };
  // 4) no key needed
  return { icon: '✅', label: 'No key needed' };
}

// ---------------------------------------------------------------------------
// Health check — test every provider's API endpoint in parallel
// ---------------------------------------------------------------------------
async function checkProvider(pv: ProviderEntry): Promise<HealthResult> {
  if (pv.id === 'opencode') {
    return { id: pv.id, status: 'ok', ms: 0, detail: 'Built-in, always available' };
  }

  // Check env var first, then secrets.json
  const hasEnvKey = pv.envKey ? !!process.env[pv.envKey] : false;
  const hasSavedKey = hasSecret(pv.id);
  if ((pv.envKey && !hasEnvKey) && !hasSavedKey) {
    return {
      id: pv.id,
      status: 'no_key',
      ms: 0,
      detail: `No API key found — run \`/free-setup ${pv.id}\` for instructions`,
    };
  }

  if (!pv.healthUrl) {
    return { id: pv.id, status: 'ok', ms: 0, detail: 'Configured (no endpoint to probe)' };
  }

  const start = performance.now();
  try {
    const headers: Record<string, string> = { 'User-Agent': 'oc-free/1.0' };
    // Use saved secret key for probe header
    const key = getSecret(pv.id) || (pv.envKey ? process.env[pv.envKey] : undefined);
    if (key && (pv.id === 'openrouter')) {
      headers['Authorization'] = `Bearer ${key}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(pv.healthUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    const ms = Math.round(performance.now() - start);

    if (res.ok || res.status === 401 || res.status === 403 || res.status === 429) {
      return {
        id: pv.id,
        status: 'ok',
        ms,
        detail: `HTTP ${res.status} in ${ms}ms — endpoint reachable`,
      };
    }
    return {
      id: pv.id,
      status: 'error',
      ms,
      detail: `HTTP ${res.status} in ${ms}ms`,
    };
  } catch (err: unknown) {
    const ms = Math.round(performance.now() - start);
    const msg = err instanceof Error ? err.message : String(err);
    return {
      id: pv.id,
      status: 'unreachable',
      ms,
      detail: `${msg}`,
    };
  }
}

function healthIcon(status: HealthResult['status']): string {
  switch (status) {
    case 'ok': return '✅';
    case 'no_key': return '⚠️';
    case 'unreachable': return '❌';
    case 'error': return '❌';
  }
}

// ---------------------------------------------------------------------------
// Plugin entry point
// ---------------------------------------------------------------------------
const ocFree = async () => {
  return {
    name: 'oc-free',

    // ── config hook ──────────────────────────────────────────────────────
    // Fires once at startup. Inject free providers and apply saved secrets.
    config: async (opencodeConfig: Record<string, unknown>) => {
      const secrets = loadSecrets();
      const providers = (opencodeConfig.provider ??= {}) as Record<string, unknown>;

      for (const pv of FREE_PROVIDERS) {
        pv.configEntry?.(providers, secrets);
      }

      // Register convenience commands
      const cmds = (opencodeConfig.command ??= {}) as Record<string, unknown>;

      cmds['free-models'] = {
        template: 'Call the free_models tool to discover free AI models',
        description: 'List all available free models across providers',
      };
      cmds['free-probe'] = {
        template: 'Test all free providers — checks API keys, endpoint connectivity, and reports live status',
        description: 'Health check for all free AI providers: tests keys, endpoints, and reports which are ready to use',
      };
      cmds['free-setup'] = {
        template: 'Interactive onboarding wizard — shows where to get keys and lets you save them',
        description: 'Set up free AI providers: shows key URLs, instructions, and saves API keys via `/free-setup apply <provider> <key>`',
      };
      cmds['toggle-free'] = {
        template: 'Toggle free-only mode for all providers',
        description: 'Switch between free-only and all models view',
      };
      for (const pv of FREE_PROVIDERS) {
        cmds[`toggle-${pv.id}`] = {
          template: `Toggle free/paid models for ${pv.id}`,
          description: `Switch between free-only and all models for ${pv.id}`,
        };
      }
      cmds['free-status'] = {
        template: 'Show free model counts for all providers',
        description: 'Show how many free/paid models each provider has',
      };
      cmds['free-hide'] = {
        template: '<model-id> — Hide a model from listings',
        description: 'Hide a specific model ID so it no longer appears in free-models output',
      };
      cmds['free-unhide'] = {
        template: '<model-id> — Unhide a previously hidden model',
        description: 'Restore a hidden model ID back into listings',
      };
      cmds['free-hidden'] = {
        template: 'List all currently hidden model IDs',
        description: 'Show every model that has been hidden via /free-hide',
      };
    },

    // ── Custom tool ──────────────────────────────────────────────────────
    tool: {
      free_models: tool({
        description:
          'Discover all free AI models across all configured free providers. Shows model IDs, capabilities, setup requirements, and allows filtering by provider.',
        args: {
          provider: z
            .string()
            .optional()
            .describe('Filter by provider name (opencode, openrouter, kilo, llm7, cline, qwen)'),
        },
        async execute(args: { provider?: string }) {
          const filter = args.provider?.toLowerCase();
          const lines: string[] = [];

          for (const pv of FREE_PROVIDERS) {
            if (filter && !pv.id.includes(filter)) continue;

            const hasKey = pv.envKey ? !!process.env[pv.envKey] : true;
            const visible = visibleModels(pv);

            lines.push(`## ${pv.id} (${pv.note})`);
            if (pv.docs) lines.push(`Docs: ${pv.docs}`);
            if (pv.envKey) {
              lines.push(`Auth: \`${pv.envKey}\` ${hasKey ? '✅ set' : '❌ not set'}`);
            }
            lines.push(`Models (${visible.length} visible):`);
            for (const m of visible) lines.push(`  - \`${m}\``);
            if (pv.all.length > 0 && isFreeOnly()) {
              lines.push(`  *${pv.all.length} paid models hidden (toggle with /toggle-${pv.id})*`);
            }
            lines.push('');
          }

          lines.push('---');
          lines.push('Commands: `/free-probe` (health check)  |  `/free-setup` (onboarding)  |  `/toggle-free`');
          lines.push(`Free-only mode: ${isFreeOnly() ? 'ON' : 'OFF'}`);

          return { output: lines.join('\n') };
        },
      }),
    },

    // ── command.execute.before ────────────────────────────────────────────
    'command.execute.before': async (
      input: { command: string; sessionID: string; arguments: string },
      output: { parts: Array<{ type: string; text: string }> },
    ) => {
      const cmd = input.command;

      // ═══════════════════════════════════════════════════════════════════
      // /free-setup  —  Onboarding wizard
      // ═══════════════════════════════════════════════════════════════════
      if (cmd === 'free-setup' || cmd.startsWith('free-setup ')) {
        const args = cmd.slice('free-setup'.length).trim();
        const parts = args.split(/\s+/);
        const sub = parts[0]?.toLowerCase();

        // ── free-setup apply <provider> <key> ──────────────────────────
        if (sub === 'apply' && parts.length >= 3) {
          const providerId = parts[1].toLowerCase();
          const apiKey = parts.slice(2).join(' ');
          const pv = FREE_PROVIDERS.find(p => p.id === providerId);
          if (!pv) {
            output.parts = [textPart(`❌ Unknown provider \`${providerId}\`. Try: openrouter, kilo, llm7, cline, qwen`)];
            return;
          }
          if (pv.setup !== 'api_key') {
            output.parts = [textPart(`⚠️ \`${providerId}\` doesn't need an API key (${pv.setupLabel}). Skipping.`)];
            return;
          }
          saveSecret(providerId, apiKey);
          // Also try writing to an env-file the user can source
          const envPath = join(OC_FREE_DIR, '.env');
          output.parts = [textPart(
            `✅ **${providerId}** key saved to \`${SECRETS_PATH}\`\n\n` +
            `Next steps:\n` +
            `1. Restart OpenCode so the key is picked up\n` +
            `2. Run \`/free-probe\` to verify connectivity\n` +
            `3. Run \`/free-models\` to see available models\n\n` +
            `📁 A reference \`.env\` file was also written to \`${envPath}\`\n` +
            `   You can \`source ${envPath}\` in your shell if needed.`
          )];
          return;
        }

        // ── free-setup <provider> — detailed instructions ──────────────
        if (sub && sub !== 'apply') {
          const pv = FREE_PROVIDERS.find(p => p.id === sub);
          if (!pv) {
            output.parts = [textPart(`❌ Unknown provider \`${sub}\`. Try: ${FREE_PROVIDERS.map(p => p.id).join(', ')}`)];
            return;
          }

          const lines: string[] = [
            `## ${setupIcon(pv.setup)} ${pv.id} — Setup Guide`,
            '',
            `${pv.note}`,
            `Docs: ${pv.docs}`,
            '',
            `**Setup type:** ${pv.setupLabel}`,
          ];

          const ks = keyStatus(pv);
          lines.push(`**Status:** ${ks.icon} ${ks.label}`);

          if (pv.setupUrl) lines.push(`**Get started:** ${pv.setupUrl}`);
          if (pv.envKey) lines.push(`**Env variable:** \`${pv.envKey}\``);
          if (pv.setupDetail) {
            lines.push('', '**Instructions:**');
            for (const line of pv.setupDetail.split('\n')) {
              lines.push(line);
            }
          }

          if (pv.setup === 'api_key') {
            if (hasSecret(pv.id)) {
              lines.push('', '✅ You already saved a key via `/free-setup apply`. Restart OpenCode to activate.');
            } else {
              lines.push('', '**To save your API key:**');
              lines.push(`  \`/free-setup apply ${pv.id} <your-key>\``);
            }
          }

          lines.push('', `Models: ${pv.free.length} free + ${pv.all.length} paid`);
          for (const m of visibleModels(pv)) lines.push(`  - \`${m}\``);

          output.parts = [textPart(lines.join('\n'))];
          return;
        }

        // ── free-setup (no args) — onboarding dashboard ────────────────
        const lines = [
          '🧭 **oc-free Onboarding Wizard**',
          'Set up your free AI providers in minutes.',
          '',
          `Run \`/free-setup <provider>\` for detailed instructions.`,
          `Run \`/free-setup apply <provider> <key>\` to save an API key.`,
          '',
          '---',
          '',
          '| Provider | Type | Status | Get Key',
          '|---|---|---|---|',
        ];

        for (const pv of FREE_PROVIDERS) {
          const ks = keyStatus(pv);
          const url = pv.setupUrl ? `[link](${pv.setupUrl})` : '—';
          lines.push(`| **${pv.id}** | ${setupIcon(pv.setup)} ${pv.setupLabel} | ${ks.icon} ${ks.label} | ${url} |`);
        }

        lines.push(
          '',
          '---',
          '**Providers needing an API key:**',
        );
        for (const pv of FREE_PROVIDERS) {
          if (pv.setup === 'api_key') {
            const saved = hasSecret(pv.id);
            lines.push(
              `  ${saved ? '✅' : '🟡'} **${pv.id}** — ${pv.setupUrl}`,
              `     \`/free-setup apply ${pv.id} <key>\` ${saved ? '(key already saved — restart to activate)' : '(save your key)'}`,
            );
          }
        }

        lines.push(
          '',
          '**Providers with OAuth / auto-setup (no key needed):**',
        );
        for (const pv of FREE_PROVIDERS) {
          if (pv.setup === 'oauth' || pv.setup === 'builtin') {
            lines.push(`  ✅ **${pv.id}** — ${pv.setupUrl || pv.docs}`);
          }
        }

        lines.push(
          '',
          '---',
          'Next: `/free-setup <provider>` for details → `/free-setup apply <provider> <key>` → restart → `/free-probe`',
        );

        output.parts = [textPart(lines.join('\n'))];
        return;
      }

      // ═══════════════════════════════════════════════════════════════════
      // /free-probe  —  Health check
      // ═══════════════════════════════════════════════════════════════════
      if (cmd === 'free-probe') {
        const lines = [
          '🔍 **oc-free Health Check**',
          'Probing every provider… (4 s timeout each)',
          '',
        ];

        const results = await Promise.all(
          FREE_PROVIDERS.map(pv => checkProvider(pv)),
        );

        let ready = 0;
        let total = 0;
        for (const r of results) {
          total++;
          if (r.status === 'ok') ready++;

          const models = visibleModels(FREE_PROVIDERS.find(p => p.id === r.id)!);
          const msLabel = r.ms > 0 ? ` ${r.ms}ms` : '';

          lines.push(`${healthIcon(r.status)} **${r.id}** — ${r.detail}${msLabel}`);
          lines.push(`   Models: ${models.length} configured`);
          if (r.status === 'no_key') {
            lines.push(`   → Run \`/free-setup ${r.id}\` for setup instructions`);
          }
        }

        lines.push('');
        lines.push(`**${ready}/${total} providers ready**`);
        if (ready === total) {
          lines.push('🎉 All free providers are configured and reachable!');
        } else if (ready > 0) {
          lines.push('Some providers need attention — check the ⚠️ / ❌ entries above.');
        } else {
          lines.push('No providers are reachable. Check your network or API keys.');
        }
        lines.push('');
        lines.push('Run `/free-setup` for the onboarding wizard or `/free-models` to see models.');

        output.parts = [textPart(lines.join('\n'))];
        return;
      }

      // ═══════════════════════════════════════════════════════════════════
      // /free-models
      // ═══════════════════════════════════════════════════════════════════
      if (cmd === 'free-models') {
        const lines = ['# Free Providers Overview', ''];
        for (const pv of FREE_PROVIDERS) {
          const hasKey = pv.envKey ? !!process.env[pv.envKey] : true;
          const visible = visibleModels(pv);
          lines.push(`## ${pv.id}`);
          lines.push(`- ${pv.note}`);
          if (pv.envKey) lines.push(`- Auth: \`${pv.envKey}\` ${hasKey ? '✅' : '❌'}`);
          lines.push(`- Models: ${visible.length} visible`);
          for (const m of visible) lines.push(`  - \`${m}\``);
          lines.push(`- Toggle: \`/toggle-${pv.id}\``, '');
        }
        lines.push(`**Free-only mode: ${isFreeOnly() ? 'ON' : 'OFF'}**`);
        lines.push('Run `/free-probe` for a live health check, `/free-setup` for onboarding');
        output.parts = [textPart(lines.join('\n'))];
        return;
      }

      // ═══════════════════════════════════════════════════════════════════
      // /toggle-free
      // ═══════════════════════════════════════════════════════════════════
      if (cmd === 'toggle-free') {
        const next = !isFreeOnly();
        saveConfig({ free_only: next });
        output.parts = [textPart(`Free-only mode: ${next ? 'ON' : 'OFF'}`)];
        return;
      }

      // ═══════════════════════════════════════════════════════════════════
      // /free-status
      // ═══════════════════════════════════════════════════════════════════
      if (cmd === 'free-status') {
        const lines = ['## Free Provider Status', ''];
        for (const pv of FREE_PROVIDERS) {
          const showPaid = getShowPaid(pv.id);
          const freeCount = pv.free.length;
          const paidCount = pv.all.length;
          const visible = isFreeOnly() || !showPaid ? freeCount : freeCount + paidCount;
          lines.push(`- **${pv.id}**: ${freeCount} free + ${paidCount} paid = ${visible} visible`);
        }
        lines.push('', `Free-only: ${isFreeOnly() ? 'ON' : 'OFF'}`);
        lines.push('', 'Run `/free-probe` for connectivity or `/free-setup` to configure');
        output.parts = [textPart(lines.join('\n'))];
        return;
      }

      // ═══════════════════════════════════════════════════════════════════
      // /free-hide
      // ═══════════════════════════════════════════════════════════════════
      if (cmd.startsWith('free-hide ')) {
        const target = cmd.slice('free-hide '.length).trim();
        if (!target) {
          output.parts = [textPart('Usage: `/free-hide <model-id>`')];
          return;
        }
        const cfg = loadConfig();
        const hidden = new Set(cfg.hidden_models ?? []);
        hidden.add(target);
        saveConfig({ hidden_models: [...hidden] });
        output.parts = [textPart(`Hidden \`${target}\`. Use \`/free-hidden\` to list hidden models.`)];
        return;
      }

      // ═══════════════════════════════════════════════════════════════════
      // /free-unhide
      // ═══════════════════════════════════════════════════════════════════
      if (cmd.startsWith('free-unhide ')) {
        const target = cmd.slice('free-unhide '.length).trim();
        if (!target) {
          output.parts = [textPart('Usage: `/free-unhide <model-id>`')];
          return;
        }
        const cfg = loadConfig();
        const hidden = new Set(cfg.hidden_models ?? []);
        if (!hidden.has(target)) {
          output.parts = [textPart(`\`${target}\` is not hidden.`)];
          return;
        }
        hidden.delete(target);
        saveConfig({ hidden_models: [...hidden] });
        output.parts = [textPart(`Unhid \`${target}\`.`)];
        return;
      }

      // ═══════════════════════════════════════════════════════════════════
      // /free-hidden
      // ═══════════════════════════════════════════════════════════════════
      if (cmd === 'free-hidden') {
        const cfg = loadConfig();
        const hidden = cfg.hidden_models ?? [];
        if (hidden.length === 0) {
          output.parts = [textPart('No hidden models.')];
          return;
        }
        output.parts = [textPart(`Hidden models:\n${hidden.map(m => `  - \`${m}\``).join('\n')}`)];
        return;
      }

      // ═══════════════════════════════════════════════════════════════════
      // /toggle-<provider>
      // ═══════════════════════════════════════════════════════════════════
      const toggleMatch = cmd.match(/^toggle-(.+)$/);
      if (toggleMatch) {
        const providerId = toggleMatch[1];
        const prov = FREE_PROVIDERS.find(p => p.id === providerId);
        if (prov) {
          const current = getShowPaid(providerId);
          const next = !current;
          saveConfig({ [`${providerId}_show_paid`]: next } as unknown as Partial<OcFreeConfig>);
          output.parts = [
            textPart(
              `${providerId}: ${next ? 'showing all models (including paid)' : `showing ${prov.free.length} free models`}`,
            ),
          ];
          return;
        }
      }
    },
  };
};

export default ocFree;
export { ocFree };
