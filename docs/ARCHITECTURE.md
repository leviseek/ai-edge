# ai-edge 总体架构设计

> Edge 浏览器插件基座：基座（稳定核心）+ 可插拔插件（业务功能）。
> 首个插件：`ai-summary`（增强版 AI 页面总结）；预留：`resource-downloader`、`video-subtitle`。

## 1. 设计目标与原则

| 原则 | 落地方式 |
| --- | --- |
| 基座无业务逻辑 | 基座只提供注册表、消息总线、设置、AI/搜索抽象、提取器、流水线引擎；任何"功能"都以插件挂载 |
| 插件可独立启停、故障隔离 | 插件激活失败只标记自身 error，不影响基座与其他插件 |
| AI/搜索供应商可插拔 | `AIProvider` / `SearchService` 适配器模式，运行时可增减 |
| 统一跨上下文通信 | 所有消息走同一 `Envelope` 协议（request/response/event） |
| 类型安全 | TypeScript strict，接口即契约 |
| Key 不外泄 | API Key 只存在于 SW 内存与 `chrome.storage.local`，Content 上下文永远拿不到 |

## 2. 运行时拓扑（Manifest V3）

```
┌─────────────────────────── Edge 浏览器 ───────────────────────────┐
│                                                                    │
│   Service Worker (background.js)        ← 基座宿主 + 编排 + 全部网络调用 │
│   ├── 基座: PluginRegistry / MessageBus / SettingsStore / Logger   │
│   ├── 服务: AIProviderRegistry / SearchServiceRegistry             │
│   ├── 插件: ai-summary (active), downloader/subtitle (预留)         │
│   └── fetch → LLM API / 搜索 API（唯一持有 API Key 的上下文）        │
│                                                                    │
│   Content Script (content.js)          ← 页面 DOM 访问 + 注入 UI      │
│   ├── 内容提取 (extractPage)             │
│   └── Shadow DOM 悬浮面板（样式与页面隔离）                            │
│                                                                    │
│   Side Panel (sidepanel.html)          ← 增强总结的主舞台              │
│   Popup (popup.html)                    ← 快捷入口                     │
│   Options (options.html)                ← Key / 模型 / 插件启停        │
│   Offscreen Document (预留)              ← 未来媒体/音频处理            │
└────────────────────────────────────────────────────────────────────┘
```

**上下文职责边界**：

| 上下文 | 能做什么 | 不能做什么 |
| --- | --- | --- |
| SW | 编排、LLM/搜索/网络调用、插件生命周期、设置读写 | 访问页面 DOM |
| Content | 读页面 DOM、注入隔离 UI、上报提取结果 | 持有 API Key、发起 LLM 调用 |
| UI（popup/sidepanel/options） | 展示、交互、触发 action | 直接持有 Key（设置页经由 SW action 写入） |

## 3. 分层架构

```
┌──────────────────────────────────────────────────────────────┐
│  UI 层        popup · side panel · options · content FAB      │
├──────────────────────────────────────────────────────────────┤
│  插件层        ai-summary(active) · downloader(预留) ·         │
│               subtitle(预留) · future...                      │
├──────────────────────────────────────────────────────────────┤
│  基座层        registry · message-bus · settings · logger      │
│               ai 抽象 · search 抽象 · extract · pipeline       │
├──────────────────────────────────────────────────────────────┤
│  运行时层      MV3 SW · content scripts · side panel · offscreen│
└──────────────────────────────────────────────────────────────┘
```

依赖方向：UI/插件 → 基座 → 运行时。插件之间不互相依赖（如需协作走总线事件）。

## 4. 消息协议（Envelope）

所有上下文之间（content ↔ SW ↔ UI）的消息统一为信封结构（`src/shared/protocol.ts`）：

```ts
type Envelope =
  | { kind: 'request';  id: string; target: Target; action: string; payload: unknown; ts: number }
  | { kind: 'response'; id: string; ok: boolean; data?: unknown;
      error?: { code: string; message: string } }
  | { kind: 'event';    channel: string; data: unknown; ts: number };

Target = 'base' | 'plugin:<pluginId>' | 'content:<id>'
```

- **request/response**：`id` 关联，SW 侧 `MessageBus.dispatch` 按 `target:action` 路由到处理器，未注册返回 `not_found`。
- **event**：SW `postEvent` 本地派发 + 广播到所有扩展上下文（UI 订阅流式进度等）。
- **跨 tab 调用**：SW → content 用 `TabMessenger.send(tabId, target, action, payload)`（`chrome.tabs.sendMessage`），与运行时消息同协议。
- 插件 action 命名空间：`plugin:<id>:<action>`，由基座在注册时强约束，插件不能越权注册别的命名空间。

**流式**（预留实现）：长连接 `chrome.runtime.connect` Port 通道承载 `event` 流（LLM token / 阶段进度），协议不变。

## 5. 基座模块

### 5.1 PluginRegistry（`src/base/registry.ts`）

- `register(manifest, create)` / 生命周期 `activate` / `deactivate` / `activateAll(enabledIds)`。
- 激活按 `dependsOn` 拓扑排序；单插件异常被捕获 → 状态置 `error` 并记录，其余插件照常。
- 状态机：`registered → activating → active ⇄ deactivating → inactive`，任意态可进 `error`。
- 启用清单持久化于 `BaseSettings.plugins.enabled`。

### 5.2 MessageBus（`src/base/message-bus.ts`）

- 处理器注册表 `target:action → handler`；`dispatch(req, sender)` 统一 try/catch → 结构化错误。
- `postEvent(channel, data)` 本地派发 + 广播 runtime。
- `sender`（来源 tab）注入 handler，供"打开当前标签面板"等场景使用。

### 5.3 SettingsStore（`src/base/settings.ts`）

```ts
interface BaseSettings {
  ai:     { activeProviderId: string; fallbackChain: string[];
            providers: Record<string, ProviderConfig> };
  search: { activeServiceId: string; services: Record<string, SearchConfig> };
  plugins:{ enabled: string[] };
  ui:     { theme: 'light'|'dark'|'auto'; summarizeModes: string[] };
}
```

- 持久化 `chrome.storage.local`，SW 启动 `load()`，变更 `onChange` 广播（UI 同步）。
- 读写只经 SW action（`base:get-settings` / `base:update-settings`），Content 上下文无设置访问。

### 5.4 AIProvider 抽象（`src/core/ai/`）

```ts
interface AIProvider {
  id: string; label: string;
  chat(messages: ChatMessage[], opts?): Promise<ChatResult>;
  chatStream(messages: ChatMessage[], opts?): AsyncIterable<ChatChunk>;  // SSE
  listModels(): Promise<ModelInfo[]>;
  healthCheck(): Promise<{ ok: boolean; latencyMs?: number; message?: string }>;
}
```

- **OpenAICompatProvider**（已实现）：任意 OpenAI-compatible 端点（`/chat/completions`），覆盖 DeepSeek、通义、Moonshot、OpenAI、Ollama、LM Studio、自建网关（one-api 类）。
- 计划：`AnthropicProvider`、`GeminiProvider`（同一接口，后续增量）。
- 选择策略：`activeProviderId` → `fallbackChain` 逐级降级（限流/失败自动切换）——M3 实现。

### 5.5 SearchService 抽象（`src/core/search/`）

```ts
interface SearchService {
  id: string; label: string;
  search(query: string, opts?: { limit?; signal? }): Promise<SearchResult[]>;
  healthCheck(): Promise<{ ok: boolean; message?: string }>;
}
```

- `TavilyService`（已实现，需 Key）、`SearxngService`（已实现，自托管免 Key）、预留 `BingService`。
- 用于横向比较阶段的候选召回。

### 5.6 ContentExtractor（`src/core/extract/`）

- content 侧 DOM 启发式：优先 `main/article/[role=main]`，按文本密度评分取最优候选；黑名单去噪（nav/footer/aside/广告/评论）。
- `chunkText` 分块：按字符预算切分、段落边界对齐、带重叠，适配长文。

### 5.7 PipelineEngine（`src/core/pipeline/pipeline.ts`）

```ts
interface Stage<I, O> { name: string; run(input: I, ctx: StageContext): Promise<O>; }
interface StageContext { log; signal: AbortSignal; emit(stage, message, progress?): void; }
```

- 顺序执行 stages，每阶段产出校验后交给下一阶段；支持中止（AbortController）与进度事件。
- 插件用流水线编排自己的多步任务（AI 总结即典型用例），流水线本身是基座通用设施。

## 6. 插件开发契约（详见 docs/PLUGIN_API.md）

```ts
interface PluginManifest {
  id: string; name: string; version: string; description: string;
  dependsOn?: string[]; permissions?: string[]; entries?: { sidePanel?: boolean; ... };
}
interface EdgePlugin<C> {
  manifest: PluginManifest;
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate(): void | Promise<void>;
}
interface PluginContext { bus: MessageBus; tabs: TabMessenger; settings: SettingsStore;
                          ai: AIProviderRegistry; search: SearchServiceRegistry; log: Logger; }
```

## 7. 功能一：AI 总结（增强版）流水线

**模式**（可组合多选）：

| 模式 | 产出 |
| --- | --- |
| `summary` | 执行摘要 + 要点列表 + 结论 |
| `feasibility` | 可行性调研：技术可行性 / 成本 / 风险 / 工作量估算 |
| `pros-cons` | 优点 / 缺点结构化 |
| `compare` | 网络搜索同品类候选 → LLM 横向对比表（含来源链接） |

**流水线**（`plugin:ai-summary` 注册的 action `summarize`）：

```
extract ──> classify ──> summarize ──> feasibility? / pros-cons? / compare? ──> assemble
  │            │            │
  │            └── 页面类型/实体/关键词(结构化JSON)
  │                                 compare: 实体+关键词 → 搜索queries
  │                                 → SearchService 召回 → LLM 综合对比表
  └─ content script 提取正文（分块）
```

数据流（`SummaryFlow`）与结果类型（`SummaryOutput`）见 `extension/src/plugins/ai-summary/types.ts`：
`meta / pageType / executiveSummary / keyPoints / verdict / feasibility / prosCons / comparison / sources`。

**compare 增强细节**：
1. classify 产出 `{ entity, category, keywords }`；
2. 构造查询（`<entity> 评测`、`<entity> 同类产品对比`…）；
3. `SearchService` 召回 top N（当前用 snippet，M4 实现深抓+再提取）；
4. LLM 综合为 `items: [{ name, url, summary, pros, cons, suitableFor }] + recommendation`；
5. 渲染表格 + 来源链接 + 「信息可能过时」免责提示。

**UI 呈现**：Side Panel 为主舞台（模式选择 → 阶段进度 → 流式结果 → 复制 Markdown/JSON）；页面内 FAB 打开侧栏；Popup 快捷入口。

## 8. 数据模型摘要

| 模型 | 位置 | 说明 |
| --- | --- | --- |
| `BaseSettings` | `base/settings.ts` | 基座全部配置（AI/搜索/插件/UI） |
| `ExtractionResult` | `core/extract/` | title/url/lang/byline/text/charCount |
| `SummaryFlow` | `plugins/ai-summary/types.ts` | 流水线中间态 |
| `SummaryOutput` | 同上 | 对外结果（UI/导出） |
| `Envelope` | `shared/protocol.ts` | 协议信封 |

## 9. 安全与边界

- API Key 仅 SW 上下文读取；UI 设置页写入也经 SW action，Content 永不触达。
- 消息校验：未知 target/action 拒绝；插件只能注册自己 `plugin:<id>` 命名空间。
- 外部 fetch：仅 HTTPS（自托管 Ollama/SearXNG 除外需用户显式配置）；`host_permissions: <all_urls>` 后续可按供应商收敛。
- 注入 UI 用 Shadow DOM，禁止远程代码执行；content 侧不做任何 LLM 调用。
- 未来插件分发：清单校验 + 最小权限声明（`permissions` 字段白名单）。

## 10. 工程与构建

- 构建：`esbuild`（scripts/build.mjs）——多入口打包 SW/content/UI 为 IIFE（MV3 要求 content 非 ESM），静态 manifest + HTML 放 `public/`，图标由脚本自动生成；`--watch` 开发态。
- 类型：`tsc --noEmit`（strict）。
- UI：React 18（esbuild `jsx: automatic`），无额外打包框架，避免版本耦合；若 UI 迭代加快可平滑迁移 Vite。

## 11. 后续演进（承接 docs/ROADMAP.md）

- M2：总结全流程打通（含自托管 Ollama 的无 Key 冒烟路径）。
- M3：增强模式（feasibility/pros-cons/compare）+ fallback 链 + 流式。
- M4：UI 打磨（Markdown 渲染、导出、可信度提示、深抓比较）。
- M5：预留插件落地（资源下载器 / 视频字幕，offscreen 媒体管道）。