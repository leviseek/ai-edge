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

## M3 — 增强模式完善 ✅

- [x] `feasibility` / `pros-cons` 结构化校验：输出规范化（字段截断/数组过滤/降级兜底）。
- [x] `compare` 深度化：搜索候选 Top N → **SW 侧深抓**（`html-extractor` 无 DOM 提取正文，多页并行容错）→ LLM 综合对比表（含来源链接，深抓失败自动降级 snippet）。
- [x] **Fallback 链**：`activeProviderId` 失败/限流（provider 类错误）→ `fallbackChain` 自动切换；`FallbackChainProvider` 记录按序尝试链，meta 携带 `usedFallback`/`fallbackChain`，UI 显示「自动降级」徽标；非提供商错误（解析/取消）不降级。
- [x] **流式**：`chrome.runtime.connect` Port 通道 `ai-summary-stream` 实时推送 token/进度/结果/错误；Side Panel 实时渲染摘要文本（含看门狗自动回退 RPC）；SSE 块内回传 `model` 保证流式也可追溯模型。

**验收**：`npm run typecheck` 零错误；`npm run build` 通过；`npm run smoke:m3` 全绿（HTML 深抓提取 / fallback 降级与非降级路径 / 单提供商包装）；`npm run smoke:summary` 仍全绿。真机链路建议在 Edge 中对产品页启用四模式跑通三合一报告并核对来源可点、模型可追溯。

## M4 — 体验与可信度打磨 ✅

- [x] 结果渲染 Markdown：自研轻量渲染器（`markdown.ts` tokenizer 纯函数可测 + `markdown-render.tsx` React 视图），零远程依赖；支持标题/列表/引用/代码块/分隔线与行内加粗/斜体/代码/链接；崩溃修复：全局正则递归重入死循环、捕获组偏位。
- [x] 可信度提示：免责声明常驻底部；对比结果嵌套生成时间「信息截至 …」；来源链接校验（HEAD→GET 兜底）为每个候选打 `✓ 可达 / ✗ 404 / · 未验证` 标记。
- [x] Side Panel「结构化 / Markdown 报告」双视图切换；页面内 FAB 升级为**快速总结卡**（Shadow DOM：模式选择、RPC 总结、进度回显、复制 Markdown、侧栏详情），content 侧发起自动以当前标签为 tabId。
- [x] 设置页新增「数据与隐私」面板：数据流说明、运行时网络授权（未授予则提示）、恢复默认设置（清除 Key）。
- [x] **host_permissions 收敛**：移除 `<all_urls>` 安装期授权，改为 `optional_host_permissions`，联网（AI/搜索/深抓）在用户触发时经 `chrome.permissions.request` 运行时按需申请。

**验收**：`npm run typecheck` 零错误；`npm run build` 通过；`npm run smoke:m4` 全绿（MD 块级/行内/引用与空行）；M2/M3 冒烟保持全绿。真机建议核对：FAB 卡快速总结、来源 ✓/✗ 标记、Markdown 报告渲染、首次联网授权弹窗。

## M5 — 预留插件落地

| 插件 | 前置基座能力 | 说明 |
| --- | --- | --- |
| `resource-downloader` | downloads 权限、资源采集器（webRequest/Performance API 双方案） | 资源分类 + AI 语义筛选 + 批量下载 |
| `video-subtitle` | Offscreen 会话管理（`ctx.media`）、ASRProvider 抽象 | 音轨采集 → ASR → 字幕注入（Shadow DOM） |

## M6 — 分发与生态

- 图标/商店素材、Edge Add-ons 审核材料（隐私政策、权限说明）。
- 插件清单签名/校验（本地可信目录）→ 发布位。
- 内置插件市场（远程清单 + 版本校验，延迟决策）。