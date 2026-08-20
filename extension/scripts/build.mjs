// ai-edge 构建脚本：esbuild 多入口打包（SW/content/UI → IIFE），public → dist，自动生成图标。
import { build, context } from 'esbuild';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url)) + '/..';
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');

// ---------- PNG 生成（无依赖，避免图标缺失导致加载告警） ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type), data]);
  return Buffer.concat([len, body, (() => { const c = Buffer.alloc(4); c.writeUInt32BE(crc32(body), 0); return c; })()]);
}
function makePng(size, [r, g, b]) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    const row = y * stride;
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const o = row + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- 构建 ----------
const entries = {
  background: 'src/background/index.ts',
  content: 'src/content/index.ts',
  offscreen: 'src/offscreen/index.ts',
  popup: 'src/ui/popup/main.tsx',
  sidepanel: 'src/ui/sidepanel/main.tsx',
  options: 'src/ui/options/main.tsx',
};

const common = {
  bundle: true,
  platform: 'browser',
  target: ['chrome110'],
  format: 'iife',
  jsx: 'automatic',
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
};

function copyPublic() {
  mkdirSync(dist, { recursive: true });
  cpSync(join(root, 'public'), dist, { recursive: true });
  mkdirSync(join(dist, 'icons'), { recursive: true });
  // 真实图标已放于 public/icons（manifest 引用 16/32/48/128）；缺失时才生成纯色占位
  for (const size of [16, 48, 128]) {
    const target = join(dist, 'icons', `icon${size}.png`);
    if (!existsSync(target)) writeFileSync(target, makePng(size, [31, 99, 255]));
  }
  console.log('[build] public/ → dist/');
}

const copyPlugin = {
  name: 'copy-public-after-build',
  setup(b) {
    b.onEnd(() => copyPublic());
  },
};

if (watch) {
  const ctx = await context({ ...common, entryPoints: entries, outdir: dist, plugins: [copyPlugin] });
  await ctx.watch();
  console.log('[build] watching... (Ctrl+C to stop)');
} else {
  await build({ ...common, entryPoints: entries, outdir: dist, plugins: [copyPlugin] });
  console.log('[build] done →', dist);
}