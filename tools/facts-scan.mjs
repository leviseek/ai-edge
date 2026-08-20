#!/usr/bin/env node
/** facts-scan CLI 入口：扫码本地项目 → facts.json / 本地服务 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { createServer } from 'node:http';
import { scanProject } from './facts-scan-lib.mjs';

function main() {
  const args = process.argv.slice(2);
  const dirIdx = args.findIndex((a) => !a.startsWith('--'));
  if (dirIdx < 0) {
    console.error('用法: node tools/facts-scan.mjs <项目目录> [--out facts.json|--serve [--port N]]');
    process.exit(1);
  }
  const dir = args[dirIdx];
  const outAt = args.indexOf('--out');
  const out = outAt >= 0 ? args[outAt + 1] : undefined;
  const serve = args.includes('--serve');
  const port = Number(args[args.indexOf('--port') + 1] || 8787);

  void scanProject(dir)
    .then((facts) => {
      const json = JSON.stringify({ project: basename(dir), scannedAt: new Date().toISOString(), count: facts.length, facts }, null, 2);
      if (serve) {
        createServer((_req, res) => {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(_req.url === '/facts.json' ? json : JSON.stringify({ project: basename(dir), count: facts.length, ok: true }));
        }).listen(port, '127.0.0.1', () => {
          console.log(`facts 服务: http://127.0.0.1:${port}/facts.json （${facts.length} 条，Ctrl+C 停止）`);
        });
        return;
      }
      if (out) {
        mkdirSync(dirname(out) || '.', { recursive: true });
        writeFileSync(out, json, 'utf8');
        console.log(`已写出 ${facts.length} 条 → ${out}`);
      } else {
        process.stdout.write(json);
      }
    })
    .catch((e) => {
      console.error('扫描失败:', e);
      process.exit(1);
    });
}

// 仅作为 CLI 直接运行（.mjs 入口）时执行 main；被库/测试 import 时不触发
if (import.meta.url.endsWith('/tools/facts-scan.mjs')) main();