import { Plugin, tool } from '@opencode-ai/plugin';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const z = tool.schema;
const HOME = process.env.HOME || process.env.USERPROFILE || '';
const OC_FREE_DIR = join(HOME, '.config', 'oc-free');
const CONFIG_PATH = join(OC_FREE_DIR, 'config.json');

interface OcFreeConfig {
  free_only?: boolean;
  kilo_show_paid?: boolean;
  cline_show_paid?: boolean;
  llm7_show_paid?: boolean;
  openrouter_show_paid?: boolean;
  qwen_show_paid?: boolean;
  hidden_models?: string[];
}

interface ProviderEntry {
  id: string;
  free: string[];
  all: string[];
  note: string;
  docs?: string;
  envKey?: string;
}

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
  },
  {
    id: 'llm7',
    free: ['llm7/default', 'llm7/fast'],
    all: [],
    note: '100 req/hr free tier',
    envKey: 'LLM7_API_KEY',
    docs: 'https://token.llm7.io',
  },
  {
    id: 'cline',
    free: ['cline/claude-sonnet-4', 'cline/claude-haiku-3.5'],
    all: [],
    note: 'Free account, no credit card',
    docs: 'https://cline.bot',
  },
  {
    id: 'qwen',
    free: ['qwen/qwen3-coder-32b', 'qwen/qwen3-plus'],
    all: [],
    note: '1000 free req/day via OAuth',
    docs: 'https://chat.qwen.ai',
  },
];

function loadConfig(): OcFreeConfig {
  try {
    if (!existsSync(CONFIG_PATH)) return { free_only: true, hidden_models: [] };
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch { return { free_only: true, hidden_models: [] }; }
}

function saveConfig(updates: Partial<OcFreeConfig>): void {
  try {
    mkdirSync(OC_FREE_DIR, { recursive: true });
    const existing = loadConfig();
    writeFileSync(CONFIG_PATH, JSON.stringify({ ...existing, ...updates }, null, 2), 'utf8');
  } catch {}
}

function getShowPaid(id: string): boolean {
  const cfg = loadConfig();
  const key = `${id}_show_paid` as keyof OcFreeConfig;
  return !!(cfg as any)[key];
}

function isFreeModel(modelId: string, providerId: string): boolean {
  const prov = FREE_PROVIDERS.find(p => p.id === providerId);
  if (!prov) return modelId.includes('free');
  return prov.free.includes(modelId);
}

const ocFree: Plugin = async () => {
  const freeOnly = { current: loadConfig().free_only ?? true };

  return {
    name: 'oc-free',

    config: async (opencodeConfig) => {
      const p = opencodeConfig.provider ??= {} as any;

      if (!p.kilo) {
        p.kilo = {
          baseUrl: 'https://api.kilo.ai/api/gateway',
          models: Object.fromEntries(
            FREE_PROVIDERS.find(x => x.id === 'kilo')!.free.map(m => {
              const id = m.split('/')[1];
              return [id, { name: id }];
            })
          ),
        };
      }

      if (!p.llm7) {
        p.llm7 = {
          baseUrl: 'https://api.llm7.io/v1',
          models: { default: { name: 'LLM7 Default' }, fast: { name: 'LLM7 Fast' } },
        };
      }

      if (!p.cline) {
        p.cline = {
          baseUrl: 'https://api.cline.bot/api/v1',
          models: { 'claude-sonnet-4': { name: 'Claude Sonnet 4' }, 'claude-haiku-3.5': { name: 'Claude Haiku 3.5' } },
        };
      }

      if (!p.qwen) {
        p.qwen = {
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          apiKey: 'oc-free-qwen',
          models: { 'qwen3-coder-32b': { name: 'Qwen3 Coder 32B' }, 'qwen3-plus': { name: 'Qwen3 Plus' } },
        };
      }

      opencodeConfig.command ??= {};
      opencodeConfig.command['free-models'] = {
        template: 'Call the free_models tool to discover free AI models',
        description: 'List all available free models across providers',
      };
      opencodeConfig.command['toggle-free'] = {
        template: 'Toggle free-only mode for all providers',
        description: 'Switch between free-only and all models view',
      };
      for (const pv of FREE_PROVIDERS) {
        opencodeConfig.command[`toggle-${pv.id}`] = {
          template: `Toggle free/paid models for ${pv.id}`,
          description: `Switch between free-only and all models for ${pv.id}`,
        };
      }
      opencodeConfig.command['free-status'] = {
        template: 'Show free model counts for all providers',
        description: 'Show how many free/paid models each provider has',
      };
    },

    tool: {
      free_models: tool({
        description: 'Discover all free AI models across all configured free providers. Shows model IDs, capabilities, setup requirements, and allows filtering by provider.',
        args: {
          provider: z.string().optional().describe('Filter by provider name (opencode, openrouter, kilo, llm7, cline, qwen)'),
        },
        async execute(args) {
          const filter = args.provider?.toLowerCase();
          const lines: string[] = [];

          const cfg = loadConfig();
          const hidden = new Set(cfg.hidden_models ?? []);

          for (const pv of FREE_PROVIDERS) {
            if (filter && !pv.id.includes(filter)) continue;

            const hasKey = pv.envKey ? !!process.env[pv.envKey] : true;
            const showPaid = getShowPaid(pv.id);
            const freeList = pv.free.filter(m => !hidden.has(m));
            const allList = [...pv.free, ...pv.all].filter(m => !hidden.has(m));

            lines.push(`## ${pv.id} (${pv.note})`);
            if (pv.docs) lines.push(`Docs: ${pv.docs}`);
            if (pv.envKey) lines.push(`Auth: \`${pv.envKey}\` ${hasKey ? '✅ set' : '❌ not set'}`);

            const display = freeOnly.current || !showPaid ? freeList : allList;
            lines.push(`Models (${display.length} visible):`);
            for (const m of display) {
              lines.push(`  - \`${m}\``);
            }
            if (pv.all.length > 0 && (freeOnly.current || !showPaid)) {
              lines.push(`  *${pv.all.length} paid models hidden (toggle with /toggle-${pv.id})*`);
            }
            lines.push('');
          }

          lines.push('---');
          lines.push('Commands: `/toggle-free` | `/toggle-{provider}` | `/free-status`');
          lines.push(`Free-only mode: ${freeOnly.current ? 'ON' : 'OFF'}`);

          return { output: lines.join('\n') };
        },
      }),
    },

    'command.execute.before': async (input, output) => {
      const cmd = input.command;

      if (cmd === 'free-models') {
        const cfg = loadConfig();
        const hidden = new Set(cfg.hidden_models ?? []);
        const lines = ['# Free Providers Overview', ''];

        for (const pv of FREE_PROVIDERS) {
          const hasKey = pv.envKey ? !!process.env[pv.envKey] : true;
          const showPaid = getShowPaid(pv.id);
          const visible = freeOnly.current || !showPaid ? pv.free : [...pv.free, ...pv.all];
          const filtered = visible.filter(m => !hidden.has(m));

          lines.push(`## ${pv.id}`);
          lines.push(`- ${pv.note}`);
          if (pv.envKey) lines.push(`- Auth: \`${pv.envKey}\` ${hasKey ? '✅' : '❌'}`);
          lines.push(`- Models: ${filtered.length} visible`);
          for (const m of filtered) lines.push(`  - \`${m}\``);
          lines.push(`- Toggle: \`/toggle-${pv.id}\``, '');
        }

        lines.push(`**Free-only mode: ${freeOnly.current ? 'ON' : 'OFF'}**`);
        lines.push('Use `/toggle-free` to switch, `/free-status` for counts');

        output.parts = [{ type: 'text', text: lines.join('\n') }];
        return;
      }

      if (cmd === 'toggle-free') {
        freeOnly.current = !freeOnly.current;
        saveConfig({ free_only: freeOnly.current });
        output.parts = [{ type: 'text', text: `Free-only mode: ${freeOnly.current ? 'ON' : 'OFF'}` }];
        return;
      }

      if (cmd === 'free-status') {
        const lines = ['## Free Provider Status', ''];
        for (const pv of FREE_PROVIDERS) {
          const showPaid = getShowPaid(pv.id);
          const freeCount = pv.free.length;
          const paidCount = pv.all.length;
          const visible = freeOnly.current || !showPaid ? freeCount : freeCount + paidCount;
          lines.push(`- **${pv.id}**: ${freeCount} free + ${paidCount} paid = ${visible} visible`);
        }
        lines.push('', `Free-only: ${freeOnly.current ? 'ON' : 'OFF'}`);
        output.parts = [{ type: 'text', text: lines.join('\n') }];
        return;
      }

      const toggleMatch = cmd.match(/^toggle-(.+)$/);
      if (toggleMatch) {
        const providerId = toggleMatch[1];
        const prov = FREE_PROVIDERS.find(p => p.id === providerId);
        if (prov) {
          const current = getShowPaid(providerId);
          const next = !current;
          saveConfig({ [`${providerId}_show_paid`]: next } as any);
          output.parts = [{
            type: 'text',
            text: `${providerId}: ${next ? 'showing all models (including paid)' : `showing ${prov.free.length} free models}`}`,
          }];
          return;
        }
      }
    },

    event: async (input) => {
      const ev = input.event;
      if (ev.type === 'session.created') {
        const models = ev as any;
      }
      if (ev.type === 'session.status' && (ev as any).status === 'error') {
      }
    },
  };
};

export default ocFree;
