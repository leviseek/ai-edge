# ai-edge 路线图

## M1 — 基座骨架（本次交付）

- [x] 架构设计文档 + archify 架构图
- [x] MV3 工程骨架（esbuild 构建、strict TS、静态 manifest）
- [x] 基座：registry / message-bus / settings / logger / tab-messenger
- [x] AIProvider 抽象 + OpenAI-compatible 适配器（DeepSeek/Qwen/Moonshot/Ollama/网关）
- [x] SearchService 抽象 + Tavily / SearXNG 适配器
- [x] 内容提取 + 分块
- [x] Pipeline 引擎
- [x] ai-summary 插件骨架（classify/summarize/feasibility/pros-cons/compare）
- [x] UI：popup / sidepanel / options（provider 与插件管理）

**验收**：`npm run typecheck` 零错误；`npm run build` 产出 dist；Edge 加载不报错；配置自托管 Ollama（或 DeepSeek Key）后可在 Side Panel 对任意页面跑通总结。

## M2 — 总结全流程打通 ✅

- [x] 无 Key 冒烟路径：默认 provider 指向 `http://localhost:11434/v1`（Ollama）；healthCheck 一键确认（Side Panel 顶部连接徽标 + Options 加载即自动检查）。
- [x] 长文多 chunk 摘要（分段摘要 + 合并；`chunkText` 修复尾部死循环，超长文按 `maxChunks=24` 截断并如实标注）。
- [x] 结果页结构化展示 + 复制 Markdown / JSON。
- [x] 运行期进度事件串联：流水线事件携带 `step/steps`，Side Panel 进度条与阶段状态实时刷新。
- [x] 可读错误：缺 Key / 鉴权失败 / 限流 / 连接失败均有中文说明，并提供「去设置页配置」引导。
- [x] 核心逻辑经 mock provider 冒烟验证：`npm run smoke:summary`（长文/短文/超长截断三场景）。

**验收**：`npm run typecheck` 零错误；`npm run build` 产出 dist；`npm run smoke:summary` 全绿；真实 LLM 链路建议在 Edge 加载后用 Side Panel 对长文/产品页/教程页分别冒烟。

## M3 — 增强模式完善

- `feasibility` / `pros-cons` 阶段 UI 化、结构化校验。
- `compare` 深度化：搜索候选 Top N → 深抓内容（SW 侧 fetch + 再次提取）→ 综合对比表（含来源链接）。
- **Fallback 链**：`activeProviderId` 失败/限流 → `fallbackChain` 自动切换，UI 提示实际所用模型。
- **流式**：chatStream 经 Port 通道实时渲染总结文本。

**验收**：一条命令式交互对任意产品页产出「可行性 + 优缺点 + 同品类对比」三合一报告，来源可点、模型可追溯。

## M4 — 体验与可信度打磨

- 结果渲染 Markdown（自研轻量渲染器，避免远程依赖）。
- 可信度提示：LLM 输出免责声明、对比时效性标注、来源链接校验（404 打标）。
- 页面内 FAB 快速总结卡（Shadow DOM）交互完善；设置页新增「数据与隐私」说明。
- host_permissions 收敛：按已配置的 AI/搜索端点动态最小化。

## M5 — 预留插件落地

| 插件 | 前置基座能力 | 说明 |
| --- | --- | --- |
| `resource-downloader` | downloads 权限、资源采集器（webRequest/Performance API 双方案） | 资源分类 + AI 语义筛选 + 批量下载 |
| `video-subtitle` | Offscreen 会话管理（`ctx.media`）、ASRProvider 抽象 | 音轨采集 → ASR → 字幕注入（Shadow DOM） |

## M6 — 分发与生态

- 图标/商店素材、Edge Add-ons 审核材料（隐私政策、权限说明）。
- 插件清单签名/校验（本地可信目录）→ 发布位。
- 内置插件市场（远程清单 + 版本校验，延迟决策）。