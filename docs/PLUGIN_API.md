# ai-edge 插件开发契约（Plugin API）

本文是「基座 + 插件」模型中**写一个新插件**的完整指南。插件 = 一个注册进基座的模块，通过 `PluginContext` 使用基座能力，通过 `MessageBus` 暴露 action 给 UI。

## 1. 最小插件

```ts
// extension/src/plugins/<id>/index.ts
import type { EdgePlugin, PluginManifest } from '../../base/registry';
import type { PluginContext } from '../../base/context';
import type { Disposer } from '../../base/message-bus';

export const MANIFEST: PluginManifest = {
  id: 'my-plugin',
  name: '我的插件',
  version: '0.1.0',
  description: '一句话描述',
  permissions: ['side-panel'],   // 可选
};

export function createPlugin(): EdgePlugin<PluginContext> {
  let disposers: Disposer[] = [];
  return {
    manifest: MANIFEST,
    async activate(ctx) {
      // 注册 action：UI/content 用 rpc('plugin:my-plugin', 'hello', payload) 调用
      disposers.push(ctx.bus.register('plugin:my-plugin', 'hello', async (payload) => {
        return { echo: payload };
      }));
      ctx.log.info('my-plugin activated');
    },
    async deactivate() {
      disposers.forEach(d => d());   // 所有副作用必须可逆
      disposers = [];
    },
  };
}
```

然后在 `src/background/index.ts`：

```ts
import { createPlugin } from '../plugins/my-plugin/index';
registry.register(MANIFEST, createPlugin);
```

并在 `DEFAULT_SETTINGS.plugins.enabled` 加入 `'my-plugin'`（或用户在选项页启用）。

UI 侧调用：

```ts
import { rpc } from '../../shared/rpc';
const res = await rpc('plugin:my-plugin', 'hello', { x: 1 });
```

## 2. PluginContext 能力面

| 成员 | 类型 | 用途 |
| --- | --- | --- |
| `bus` | `MessageBus` | 注册 action、订阅/发布事件 |
| `tabs` | `TabMessenger` | 向指定 tab 的 content script 发请求（提取页面等） |
| `settings` | `SettingsStore` | 读基座设置；插件自身配置建议用 `settings` 独立命名空间（后续版本提供 `plugin.<id>.*` 分区） |
| `ai` | `AIProviderRegistry` | 按 id 取 provider，`chat` / `chatStream` |
| `search` | `SearchServiceRegistry` | 按 id 取搜索服务 |
| `log` | `Logger` | `ctx.log.child('my-stage')` 等 |

## 3. 消息（action / event）约定

- **action 命名空间被基座强约束**：注册 target 必须前缀 `plugin:<id>`。
- action 载荷与返回值必须为 **JSON 可序列化**（跨上下文通信限制）。
- **event 通道**：`postEvent('plugin:<id>:<topic>', data)`，UI 侧 `chrome.runtime.onMessage` 过滤 `kind === 'event'`。
- 不要直接 `chrome.*` 网络调用做 LLM/搜索——一律走 `ctx.ai` / `ctx.search`（Key 管理统一）。

## 4. 生命周期与故障隔离

- `activate` 内所有副作用（bus 注册、定时器、监听）必须返回 disposer 并在 `deactivate` 里清理。
- `activate` 抛错 → 基座捕获，插件状态置 `error`，**不影响其它插件与基座**。
- 插件被禁用（`base:set-plugin-enabled`）→ `deactivate` 幂等执行。

## 5. 用流水线编排多步任务

长任务（如总结）建议拆为 stages 用基座 `Pipeline` 编排，自动获得进度事件与中止能力：

```ts
import { Pipeline, type Stage, type StageContext } from '../../core/pipeline/pipeline';

interface MyFlow { ... }
class StepA implements Stage<MyFlow, MyFlow> {
  name = 'step-a';
  async run(input: MyFlow, ctx: StageContext): Promise<MyFlow> { ... return input; }
}
const out = await new Pipeline([new StepA(), new StepB()]).run(flow, stageCtx);
```

- stage 内做 LLM 长调用时把 `ctx.signal` 传入 `opts.signal` 以支持中止。
- `ctx.emit(stage, message, progress)` 推送到 `plugin:<id>:progress` 通道，UI 渲染阶段指示器。

## 6. 预留插件设计

### 6.1 `resource-downloader`（AI 下载页面资源）——M5

- **目标**：识别当前页面网络传输的各种类型资源（图片/字体/媒体/preload/API 响应等），可选后由 AI 协助批量下载。
- **关键点**：
  - 用 `webRequest` / `PerformanceResourceTiming`（content 侧，页面可观测）采集资源表，按类型聚合；
  - downloads API 下载需用户手势与权限，`permissions: ['downloads', 'webRequest']`（webRequest 为受限权限，需 Edge 商店审核权衡，可降级为 Performance API 方案）；
  - 插件 manifest：`permissions: ['downloads']`；action：`plugin:resource-downloader:list`、`:download`。
- **扩展点**：资源类型过滤器注册表（`ResourceClassifier` 接口），AI 语义筛选作为可选阶段。

### 6.2 `video-subtitle`（AI 视频字幕）——M5

- **目标**：对页面内 `<video>` 生成/翻译字幕。
- **关键点**：音轨提取只能在 **Offscreen Document**（MV3 无 DOM 的 SW 不能 Media API）；`chrome.tabCapture` 采集标签音频或直接取页面媒体源；ASR（Whisper 类 API，经 `AIProvider` 扩展或独立 `ASRProvider`）；字幕注入用 content 侧 Shadow DOM + 原生 track 事件。
- **扩展点**：`ASRProvider` 接口（LLM 提供商之外的新能力面）；字幕渲染器可插拔（双语/样式）。
- **行动项**：需新增基座能力 `ctx.media`（Offscreen 会话管理）——在 M5 排期。

## 7. 新插件接入清单

1. 建目录 `src/plugins/<id>/`：`manifest.ts` + `index.ts` + `types.ts` + `stages/`（如需要）；
2. 实现 `EdgePlugin`，`activate` 里注册 `plugin:<id>` 命名空间 action；
3. `background/index.ts` 注册插件，`DEFAULT_SETTINGS.plugins.enabled` 加入默认启用（或文档说明在选项页开启）；
4. UI 需要时：sidepanel/popup 增加入口页签或按钮；Options 页增加开关；
5. `npm run typecheck && npm run build` 冒烟。

## 8. 规范红线

- ❌ 插件内直接访问 `chrome.storage` 属违规（统一走 `bus` action / `ctx.settings`），Key 管理不得绕过基座。
- ❌ action 载荷传不可序列化对象（DOM 节点/函数）。
- ✅ 所有副作用可逆；✅ 错误用 `EdgeError(code, message)` 抛出，让 UI 拿到结构化错误。