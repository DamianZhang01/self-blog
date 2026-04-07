/**
 * 下载豆瓣封面图到 src/assets/covers/{type}/{首字母}/
 * 文件名为豆瓣 id，保留原扩展名（webp/jpg）
 * 用法: node scripts/download-covers.mjs
 *
 * 拼音首字母映射：取标题第一个字符
 *   - 汉字 → 拼音声母（via Unicode 区间粗略映射）
 *   - 英文/数字 → 该字母小写 / '0'
 *   - 其他 → 'other'
 */

import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── 汉字声母映射（Intl.Collator zh-CN pinyin 排序） ─────────────────────────
const _collator = new Intl.Collator('zh-CN-u-co-pinyin');
const _boundaries = [
  ['a', '啊'], ['b', '芭'], ['c', '擦'], ['d', '搭'], ['e', '鹅'],
  ['f', '发'], ['g', '噶'], ['h', '哈'], ['j', '击'], ['k', '喀'],
  ['l', '垃'], ['m', '妈'], ['n', '拿'], ['o', '哦'], ['p', '啪'],
  ['q', '期'], ['r', '然'], ['s', '撒'], ['t', '塌'], ['w', '挖'],
  ['x', '昔'], ['y', '压'], ['z', '匝'], ['z_end', '\uFFFF'],
];

function getInitial(char) {
  const code = char.charCodeAt(0);
  if (code >= 65 && code <= 90) return char.toLowerCase();
  if (code >= 97 && code <= 122) return char;
  if (code >= 48 && code <= 57) return '0';
  if (code < 0x4e00 || code > 0x9fa5) return 'other';
  for (let i = 0; i < _boundaries.length - 1; i++) {
    const [letter, boundary] = _boundaries[i];
    const [, nextBoundary] = _boundaries[i + 1];
    if (_collator.compare(char, boundary) >= 0 && _collator.compare(char, nextBoundary) < 0) {
      return letter;
    }
  }
  return 'other';
}

function getFirstInitial(title) {
  if (!title) return 'other';
  const first = title[0];
  return getInitial(first);
}

// ── 下载单张图片 ──────────────────────────────────────────────────────────────
async function downloadImage(url, destPath) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Referer': 'https://movie.douban.com/',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(destPath, buf);
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
async function main() {
  const raw = readFileSync(join(ROOT, 'data/douban.json'), 'utf-8');
  const db = JSON.parse(raw);

  const items = [
    ...(db.movies || []).map(m => ({ ...m, mediaType: 'movie' })),
    ...(db.books  || []).map(b => ({ ...b, mediaType: 'book'  })),
    ...(db.games  || []).map(g => ({ ...g, mediaType: 'game'  })),
  ].filter(item => item.id && item.cover);

  console.log(`Total items to process: ${items.length}`);

  let downloaded = 0, skipped = 0, failed = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const initial = getFirstInitial(item.title);
    const dir = join(ROOT, 'public/covers', item.mediaType, initial);
    mkdirSync(dir, { recursive: true });

    // 保留原 url 扩展名，没有则默认 .webp
    const urlExt = extname(new URL(item.cover).pathname) || '.webp';
    const destPath = join(dir, `${item.id}${urlExt}`);

    if (existsSync(destPath)) {
      skipped++;
      continue;
    }

    try {
      await downloadImage(item.cover, destPath);
      downloaded++;
      if (downloaded % 50 === 0) {
        console.log(`  [${i + 1}/${items.length}] downloaded=${downloaded} skipped=${skipped} failed=${failed}`);
      }
    } catch (e) {
      failed++;
      console.warn(`  FAIL [${item.id}] ${item.title}: ${e.message}`);
    }

    // 礼貌延迟，避免触发限速
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\nDone. downloaded=${downloaded} skipped=${skipped} failed=${failed}`);
}

main().catch(e => { console.error(e); process.exit(1); });
