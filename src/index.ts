import { tool } from '@opencode-ai/plugin';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const z = tool.schema;

// ---------------------------------------------------------------------------
// Config paths
// ---------------------------------------------------------------------------
const HOME = process.env.HOME || process.env.USERPROFILE || '';
const OC_FREE_DIR = join(HOME, '.config', 'oc-free');
const CONFIG_PATH = join(OC_FREE_DIR, 'config.json');

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

interface HealthResult {
  id: string;
  status: 'ok' | 'no_key' | 'unreachable' | 'error';
  ms: number;
  detail: string;
}

interface ProviderEntry {
  id: string;
  free: string[];
  all: string[];
  note: string;
  docs?: string;
  envKey?: string;
  /** Base URL used for connectivity health checks */
  healthUrl?: string;
  /** Auto-register the provider config so models actually work */
  configEntry?: (providers: Record<string, unknown>) => void;
}

// ---------------------------------------------------------------------------
// Provider config builders
// ---------------------------------------------------------------------------
function configureKilo(providers: Record<string, unknown>) {
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

function configureLlm7(providers: Record<string, unknown>) {
  if (providers.llm7) return;
  providers.llm7 = {
    baseUrl: 'https://api.llm7.io/v1',
    models: {
      default: { name: 'LLM7 Default' },
      fast: { name: 'LLM7 Fast' },
    },
  };
}

function configureCline(providers: Record<string, unknown>) {
  if (providers.cline) return;
  providers.cline = {
    baseUrl: 'https://api.cline.bot/api/v1',
    models: {
      'claude-sonnet-4': { name: 'Claude Sonnet 4' },
      'claude-haiku-3.5': { name: 'Claude Haiku 3.5' },
    },
  };
}

function configureQwen(providers: Record<string, unknown>) {
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

function configureOpenrouter(providers: Record<string, unknown>) {
  if (providers.openrouter) return;
  const models = FREE_PROVIDERS.find(x => x.id === 'openrouter')!.free.map(m => {
    const key = m.replace(/^openrouter\//, '');
    return [key, { name: key }];
  });
  providers.openrouter = {
    baseUrl: 'https://openrouter.ai/api/v1',
    models: Object.fromEntries(models),
  };
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
    healthUrl: 'https://api.llm7.io/v1',
    configEntry: configureLlm7,
  },
  {
    id: 'cline',
    free: ['cline/claude-sonnet-4', 'cline/claude-haiku-3.5'],
    all: [],
    note: 'Free account, no credit card',
    docs: 'https://cline.bot',
    healthUrl: 'https://api.cline.bot/api/v1',
    configEntry: configureCline,
  },
  {
    id: 'qwen',
    free: ['qwen/qwen3-coder-32b', 'qwen/qwen3-plus'],
    all: [],
    note: '1000 free req/day via OAuth',
    docs: 'https://chat.qwen.ai',
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
    writeFileSync(
      CONFIG_PATH,
      JSON.stringify({ ...existing, ...updates }, null, 2),
      'utf8',
    );
  } catch {
    // Best-effort
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

// ---------------------------------------------------------------------------
// Health check — test every provider's API endpoint in parallel
// ---------------------------------------------------------------------------
async function checkProvider(pv: ProviderEntry): Promise<HealthResult> {
  // 1) OpenCode is always available (built-in provider)
  if (pv.id === 'opencode') {
    return { id: pv.id, status: 'ok', ms: 0, detail: 'Built-in, always available' };
  }

  // 2) Check env key presence
  if (pv.envKey && !process.env[pv.envKey]) {
    return {
      id: pv.id,
      status: 'no_key',
      ms: 0,
      detail: `Missing \`${pv.envKey}\` env var — set it or configure via opencode.json`,
    };
  }

  // 3) Probe API endpoint with a lightweight GET (3 second timeout)
  if (!pv.healthUrl) {
    return { id: pv.id, status: 'ok', ms: 0, detail: 'Configured (no endpoint to probe)' };
  }

  const start = performance.now();
  try {
    // Build headers — include API key if available (some providers need it)
    const headers: Record<string, string> = { 'User-Agent': 'oc-free/1.0' };
    if (pv.envKey && process.env[pv.envKey]) {
      if (pv.id === 'openrouter') {
        headers['Authorization'] = `Bearer ${process.env[pv.envKey]!}`;
      }
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

    // Any response (including 4xx) means the endpoint is reachable
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
    config: async (opencodeConfig: Record<string, unknown>) => {
      const providers = (opencodeConfig.provider ??= {}) as Record<string, unknown>;

      for (const pv of FREE_PROVIDERS) {
        pv.configEntry?.(providers);
      }

      const cmds = (opencodeConfig.command ??= {}) as Record<string, unknown>;

      cmds['free-models'] = {
        template: 'Call the free_models tool to discover free AI models',
        description: 'List all available free models across providers',
      };
      cmds['free-probe'] = {
        template: 'Test all free providers — checks API keys, endpoint connectivity, and reports live status',
        description: 'Health check for all free AI providers: tests keys, endpoints, and reports which are ready to use',
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
        description:
          'Hide a specific model ID so it no longer appears in free-models output',
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
          lines.push('Commands: `/free-probe` (health check)  |  `/toggle-free`  |  `/free-status`');
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
      // /free-probe   —  Health check: test all providers in real time
      // ═══════════════════════════════════════════════════════════════════
      if (cmd === 'free-probe') {
        const lines = [
          '🔍 **oc-free Health Check**',
          'Probing every provider… (4 s timeout each)',
          '',
        ];

        // Run checks in parallel
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

          lines.push(
            `${healthIcon(r.status)} **${r.id}** — ${r.detail}${msLabel}`,
          );
          lines.push(`   Models: ${models.length} configured`);
          if (r.status === 'no_key') {
            lines.push(`   → Set \`${FREE_PROVIDERS.find(p => p.id === r.id)?.envKey}\` or run \`/toggle-${r.id}\``);
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
        lines.push('Run `/free-models` to see available models, `/free-status` for counts.');

        output.parts = [textPart(lines.join('\n'))];
        return;
      }

      // ═══════════════════════════════════════════════════════════════════
      // /free-models  —  list all free models
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
        lines.push('Run `/free-probe` for a live health check, `/free-status` for counts');
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
        lines.push('', 'Run `/free-probe` for a live connectivity health check');
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
