/** 基座：设置存储（SW 侧持有，UI 经 action 读写） */
export interface ProviderConfig {
  kind: 'openai-compat';
  label?: string;
  baseUrl: string;
  apiKey: string; // 明文存 chrome.storage.local（M4 改为加密存储/仅内存）
  model: string;
}

export type SearchServiceKind = 'tavily' | 'searxng';

export interface SearchConfig {
  kind: SearchServiceKind;
  label?: string;
  apiKey?: string;
  baseUrl?: string;
}

/** ASR（语音识别）提供商配置 */
export interface AsrConfig {
  kind: 'openai-whisper';
  label?: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface BaseSettings {
  ai: {
    activeProviderId: string;
    fallbackChain: string[];
    providers: Record<string, ProviderConfig>;
  };
  search: {
    activeServiceId: string;
    services: Record<string, SearchConfig>;
  };
  asr: {
    activeAsrId: string;
    providers: Record<string, AsrConfig>;
  };
  plugins: {
    enabled: string[];
  };
  ui: {
    theme: 'light' | 'dark' | 'auto';
    summarizeModes: string[];
  };
}

export const DEFAULT_SETTINGS: BaseSettings = {
  ai: {
    activeProviderId: 'deepseek',
    fallbackChain: [],
    providers: {
      deepseek: {
        kind: 'openai-compat',
        label: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        apiKey: '',
        model: 'deepseek-chat',
      },
      openai: {
        kind: 'openai-compat',
        label: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-4o-mini',
      },
      ollama: {
        kind: 'openai-compat',
        label: 'Ollama (本地)',
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'llama3.2',
      },
    },
  },
  search: {
    activeServiceId: 'searxng',
    services: {
      searxng: { kind: 'searxng', label: 'SearXNG (自托管)', baseUrl: 'http://localhost:8080' },
      tavily: { kind: 'tavily', label: 'Tavily', apiKey: '' },
    },
  },
  asr: {
    activeAsrId: 'whisper',
    providers: {
      whisper: {
        kind: 'openai-whisper',
        label: 'OpenAI Whisper',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'whisper-1',
      },
    },
  },
  plugins: {
    enabled: ['ai-summary', 'resource-downloader', 'video-subtitle'],
  },
  ui: {
    theme: 'auto',
    summarizeModes: ['summary'],
  },
};

const STORAGE_KEY = 'ai-edge:settings';

function deepMerge<T>(base: T, patch: unknown): T {
  if (Array.isArray(base)) {
    // 数组合并（默认在先、存储在后去重）：保证新增内置插件默认启用，且不覆盖用户已禁用的项
    const patchArr = Array.isArray(patch) ? (patch as unknown[]) : [];
    const merged = [...patchArr, ...(base as unknown[])];
    return merged.filter((v, i) => merged.indexOf(v) === i) as T;
  }
  if (base !== null && typeof base === 'object') {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    if (patch && typeof patch === 'object') {
      for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
        // 数组与标量直接覆盖，嵌套对象递归合并
        out[k] =
          k in out && typeof v === 'object' && v !== null && !Array.isArray(v) && typeof out[k] === 'object' && out[k] !== null
            ? deepMerge(out[k], v)
            : v;
      }
    }
    return out as T;
  }
  return (patch as T) ?? base;
}

export class SettingsStore {
  private cache: BaseSettings = structuredClone(DEFAULT_SETTINGS);
  private listeners = new Set<(s: BaseSettings) => void>();

  async load(): Promise<void> {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const raw = stored[STORAGE_KEY] as unknown;
    if (raw && typeof raw === 'object') this.cache = deepMerge(DEFAULT_SETTINGS, raw);
    this.emit();
  }

  get(): BaseSettings {
    return this.cache;
  }

  async set<K extends keyof BaseSettings>(key: K, value: BaseSettings[K]): Promise<void> {
    this.cache = { ...this.cache, [key]: value };
    await this.persist();
  }

  async patch(patch: Partial<BaseSettings>): Promise<void> {
    this.cache = deepMerge(this.cache, patch);
    await this.persist();
  }

  /** 恢复默认设置（清空本地配置） */
  async resetToDefaults(): Promise<BaseSettings> {
    this.cache = structuredClone(DEFAULT_SETTINGS);
    await chrome.storage.local.remove(STORAGE_KEY);
    this.emit();
    return this.cache;
  }

  onChange(fn: (s: BaseSettings) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private async persist(): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEY]: this.cache });
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.cache);
  }
}