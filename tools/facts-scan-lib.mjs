/**
 * facts-scan 纯逻辑库（无副作用入口，可被插件冒烟测试 import）。
 * CLI 入口见 tools/facts-scan.mjs。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, extname, basename, relative, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_SECTIONS = {
  已实现: ['已实现', '已完成', '功能特性', 'Features', 'What', 'done', '目前支持'],
  决策: ['决策', 'Decisions', '技术选型', '设计决策'],
  架构: ['架构', 'Architecture', '模块', '目录结构'],
  待办: ['待办', 'TODO', 'Roadmap', '后续', '计划', '未实现'],
  限制: ['限制', 'Limitations', '已知问题', 'Known issues'],
};

export const DEFAULT_IGNORE = ['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.smoke', '.dsh', '*.lock', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'];
const MD_EXTS = new Set(['.md', '.markdown', '.txt', '.rst']);
const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.go', '.java', '.rs', '.c', '.h', '.cpp', '.sh', '.yml', '.yaml']);

export function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function newEntry(kind, title, detail, path, updatedAt = Date.now()) {
  return { id: `scan-${hash(kind + ':' + title)}`, kind, title: title.slice(0, 80), detail: (detail || '').slice(0, 500), path: path || '', tags: [], updatedAt };
}

export function walk(dir, ignore) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let ents;
    try {
      ents = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      const p = join(cur, e.name);
      const rel = relative(dir, p);
      if (ignore.some((ig) => rel === ig || rel.startsWith(ig.replace(/[*]/g, '__') + '/') || e.name === ig)) continue;
      if (e.isDirectory()) stack.push(p);
      else out.push(p);
    }
  }
  return out;
}

export function parseMarkdownFacts(text, filePath, sections = DEFAULT_SECTIONS) {
  const facts = [];
  const headMap = {};
  for (const [k, heads] of Object.entries(sections)) for (const h of heads) headMap[h.toLowerCase()] = k;
  let kind = null;
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      const hkey = heading[1].toLowerCase();
      kind = null;
      for (const [kw, k] of Object.entries(headMap)) {
        if (hkey.includes(kw)) {
          kind = k;
          break;
        }
      }
      continue;
    }
    const isBullet = /^[-*+]/.test(line) || /^\d+[.)]/.test(line);
    if (!isBullet) continue;
    const item = line.replace(/^[-*+]\s*/, '').replace(/^\d+[.)]\s*/, '');
    if (!item || item.length < 2) continue;
    const sep = item.indexOf('：');
    const title = (sep > 0 ? item.slice(0, sep) : item.split('。')[0]).trim().slice(0, 80);
    const detail = sep > 0 ? item.slice(sep + 1) : '';
    if (!title) continue;
    // 无已知章节时按行内关键词兜底，仍无匹配则跳过（避免噪音）
    let outKind = kind;
    if (!outKind) {
      if (/(已实现|已完成|目前支持|已支持|现在支持)/.test(item)) outKind = '已实现';
      else if (/(TODO|FIXME|待办|未实现|后续|计划|要做)/.test(item)) outKind = '待办';
      else if (/(决策|选型|约定|决定)\s*[:：]/.test(item)) outKind = '决策';
      else if (/(限制|局限|注意|不允许)/.test(item)) outKind = '限制';
      else continue;
    }
    facts.push(newEntry(outKind, title, detail, filePath || ''));
  }
  return facts;
}

export function parsePackageJson(p) {
  const facts = [];
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    const name = j.name || basename(p);
    facts.push(newEntry('架构', `包：${name}`, j.description ? String(j.description).slice(0, 120) : '', p));
    if (j.type) facts.push(newEntry('决策', `模块类型 ${j.type}`, '', p));
    const deps = Object.entries({ ...(j.dependencies || {}), ...(j.devDependencies || {}) }).slice(0, 12);
    if (deps.length) facts.push(newEntry('决策', '依赖清单', deps.map(([k, v]) => `${k}@${v}`).join('，'), p));
    const scripts = Object.entries(j.scripts || {}).slice(0, 10);
    if (scripts.length) facts.push(newEntry('架构', 'npm scripts', scripts.map(([k, v]) => `${k}: ${v}`).join('；'), p));
  } catch {
    /* 忽略 */
  }
  return facts;
}

export function codeTodos(p) {
  const facts = [];
  try {
    const t = readFileSync(p, 'utf8');
    const lines = t.split('\n');
    const seen = new Set();
    for (let i = 0; i < lines.length && facts.length < 30; i++) {
      const m = /(TODO|FIXME|待办|未实现)[:：]?\s*([^\n]{2,80})/.exec(lines[i]);
      if (!m) continue;
      const key = m[2].trim();
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push(newEntry('待办', `TODO: ${key.slice(0, 60)}`, `L${i + 1}`, p));
    }
  } catch {
    /* 忽略 */
  }
  return facts;
}

export function loadConfig(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, '.aiedge-facts.json'), 'utf8'));
  } catch {
    return {};
  }
}

export async function scanProject(dir, cfg = {}) {
  const abs = isAbsolute(dir) ? dir : resolve(dir);
  const conf = {
    sections: { ...DEFAULT_SECTIONS, ...(cfg.sections || {}) },
    ignore: [...DEFAULT_IGNORE, ...(cfg.ignore || [])],
    srcRoots: cfg.srcRoots || ['src', 'lib', 'app', 'packages'],
  };
  const files = walk(abs, conf.ignore);
  const facts = [];
  const relOf = (p) => relative(abs, p).replace(/\\/g, '/');

  for (const f of files) {
    if (MD_EXTS.has(extname(f))) {
      try {
        facts.push(...parseMarkdownFacts(readFileSync(f, 'utf8'), relOf(f), conf.sections));
      } catch {
        /* 忽略 */
      }
    } else if (CODE_EXTS.has(extname(f)) && /(src|lib|app|packages|scripts|server|client)/.test(relOf(f))) {
      facts.push(...codeTodos(f));
    }
  }

  const pkg = join(abs, 'package.json');
  if (existsSync(pkg)) facts.push(...parsePackageJson(pkg));

  for (const root of conf.srcRoots) {
    const rd = join(abs, root);
    if (!existsSync(rd)) continue;
    try {
      for (const e of readdirSync(rd, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue;
        facts.push(newEntry('架构', `${root}/${e.name}${e.isDirectory() ? '/' : ''}`, '源码顶层模块', `${root}/${e.name}`));
      }
    } catch {
      /* 忽略 */
    }
  }

  const byKey = new Map();
  for (const f of facts) {
    const k = f.kind + ':' + f.title;
    if (byKey.has(k)) {
      const prev = byKey.get(k);
      if (f.detail && !prev.detail) prev.detail = f.detail;
      continue;
    }
    byKey.set(k, { ...f, updatedAt: Date.now() });
  }
  return [...byKey.values()];
}

// 被误当作 CLI 直接执行时给出指引
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.error(
    '✗ 这是 facts-scan 的【核心库】，没有 CLI 入口。\n' +
      '   请执行 CLI：  node tools/facts-scan.mjs <项目目录> --serve\n' +
      '   或看帮助：    node tools/facts-scan.mjs',
  );
  process.exit(1);
}