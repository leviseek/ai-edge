/** 项目事实锚（去幻觉）：manifest */
import type { PluginManifest } from '../../base/registry';

export const PROJECT_FACTS_MANIFEST: PluginManifest = {
  id: 'project-facts',
  name: '项目事实锚',
  version: '0.1.0',
  description: '记录项目真实事实(已实现/决策/架构/待办)，生成会话锚定 Brief，检测网页版 AI 会话中的“已完成”幻觉',
  permissions: ['content-scan', 'kb'],
};