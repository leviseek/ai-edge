# ai-edge

**Edge 浏览器插件基座**（Microsoft Edge / Chromium，Manifest V3）。

一个以「基座 + 可插拔插件」为核心模型的浏览器扩展工程：基座只提供能力与编排（插件注册表、生命周期、消息总线、设置、AI 提供商抽象、网络搜索抽象、内容提取、流水线引擎），所有业务功能以**插件**形态挂载，可独立启停、故障隔离、逐步扩展。

## 当前能力

| 插件 | 状态 | 说明 |
| --- | --- | --- |
| `ai-summary` | ✅ 可用 | AI 总结页面内容：核心摘要 / 可行性调研 / 优缺点 / 同品类横向比较（长文分段合并、流式实时渲染、fallback 自动降级、来源校验） |
| `resource-downloader` | ✅ 可用 | 扫描/分类当前页网络资源（Performance-API），AI 语义筛选，downloads API 批量下载（Popup 操作） |
| `video-subtitle` | 🔶 骨架 | Offscreen 解码 + Whisper ASR 转写核心链路可用（URL 音频→字幕）；页面 `<video>` 音频捕获为二期 |
| `project-facts` | ✅ 可用 | 项目事实锚：记录「已实现/决策/架构/待办」真实状态，生成会话锚定 Brief；在 ChatGPT/Claude/DeepSeek 等页面检测「已完成」类幻觉并一键澄清 |

## 对抗 AI 会话幻觉（项目事实锚）

网页版 AI 会话过长时会把“未实现”当成“已实现”。用 ai-edge 的「项目事实锚」：

1. 侧栏 →「项目事实」→ 把你的项目真实状态导入（Markdown 小节 / `[KIND]` 前缀 / JSON），或手工逐条添加「已实现/决策/架构/待办/限制」。
2. 点「生成 Brief」→「复制会话 Brief」，把这段「以此为准」粘贴到任意 AI 会话开头（会话变长/换会话都重贴一次）。
3. 在 ChatGPT / Claude / DeepSeek 等页面：脚本自动扫描助手消息中「已实现/已完成/当前版本…」类断言，与 KB 比对——不匹配就给对应消息挂「⚠ 疑似幻觉」，点一下即复制「澄清请求」话术；侧栏「扫描当前会话」可整段诊断。

## 快速开始

```bash
cd extension
npm install
npm run typecheck   # 类型检查
npm run build       # 产出 dist/
```

然后打开 Edge：`edge://extensions` → 打开「开发人员模式」→「加载解压缩的扩展」→ 选择 `extension/dist` 目录。

开发态热更新：`npm run dev`（esbuild watch 自动重建，手动在扩展页点刷新即可）。

## 目录结构

```
ai-edge/
├── docs/                    # 架构设计文档
│   ├── ARCHITECTURE.md      # 总体架构（分层 / 运行时拓扑 / 消息协议 / 数据模型）
│   ├── PLUGIN_API.md        # 插件开发契约（写新插件的完整指南）
│   └── ROADMAP.md           # 里程碑路线图
├── diagrams/                # archify 架构图（浏览器打开 HTML）
└── extension/               # 工程本体（TypeScript + Manifest V3）
    ├── public/              # 静态资源：manifest.json / HTML / CSS / 图标
    ├── scripts/build.mjs    # esbuild 构建脚本（自动生成图标）
    └── src/
        ├── base/            # 基座：registry / message-bus / settings / logger
        ├── core/            # 基座服务：ai / search / extract / pipeline
        ├── plugins/         # 业务插件（ai-summary 等）
        ├── background/      # Service Worker 入口
        ├── content/         # Content Script 入口
        ├── ui/              # popup / sidepanel / options（React）
        └── shared/          # 跨上下文共享：协议 / rpc / 工具
```

## 设计要点（详见 docs/ARCHITECTURE.md）

- **基座无业务逻辑**：只提供注册表、总线、设置、AI/搜索抽象，业务全部进插件。
- **统一消息协议**：`Envelope {request|response|event}`，插件 action 命名空间 = `plugin:<id>:<action>`。
- **AI 提供商抽象**：`AIProvider` 接口 + OpenAI-compatible 适配器（覆盖 DeepSeek / Qwen / Moonshot / Ollama / 自建网关），可扩展 Anthropic/Gemini。
- **搜索抽象**：`SearchService` 接口 + Tavily / SearXNG 适配器，供横向比较召回候选。
- **流水线引擎**：AI 总结为多阶段 Pipeline（提取 → 分类 → 总结 → 增强模式），每阶段可独立替换、可中止、发进度事件。
- **安全**：API Key 仅存 SW 侧 `chrome.storage.local`，Content 上下文永远接触不到 Key。

## 路线图

见 `docs/ROADMAP.md`（M1 基座骨架 → M2 总结全流程 → M3 增强模式 → M4 体验打磨 → M5 预留插件）。