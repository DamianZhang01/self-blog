/**
 * 从 douban.json 生成 src/content/media/{type}/{首字母}/中文名.md
 * 已存在的文件不覆盖（保留用户手写的长评）
 * 用法: node scripts/gen-media-md.mjs
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
  return getInitial(title[0]);
}

// ── 构造本地封面路径（public/ 下的绝对路径，由页面直接引用） ─────────────────
function localCoverPath(id, mediaType, title, coverUrl) {
  if (!coverUrl) return null;
  const initial = getFirstInitial(title);
  const urlExt = extname(new URL(coverUrl).pathname) || '.webp';
  // 存放在 public/covers/{type}/{initial}/{id}.webp
  // 页面引用时加 base URL 前缀即可
  return `/covers/${mediaType}/${initial}/${id}${urlExt}`;
}

// ── 转义 frontmatter 字符串（防止冒号/引号破坏 yaml） ────────────────────────
function yamlStr(s) {
  if (!s) return '""';
  // 纯数字、boolean 关键字、特殊字符都加双引号
  if (/^[\d.]+$/.test(s) || /^(true|false|null|yes|no)$/i.test(s) ||
      /[:#\[\]{},&*?|<>=!%@`\n"]/.test(s) || s.startsWith(' ') || s.endsWith(' ')) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

// ── 生成单条 md 内容 ─────────────────────────────────────────────────────────
function buildMd(item, mediaType) {
  const date = (item.markedAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  const score = item.halfRating ?? item.rating ?? null;
  const cover = localCoverPath(item.id, mediaType, item.title, item.cover);

  // tags：genres（电影）或 tags（书）
  const rawTags = item.genres || item.tags || [];
  // 过滤掉 hashTags（场馆信息），只保留内容标签
  const hashTagSet = new Set(item.hashTags || []);
  const tags = rawTags.filter(t => !hashTagSet.has(t));

  const lines = ['---'];
  lines.push(`title: ${yamlStr(item.title)}`);
  lines.push(`date: ${date}`);
  lines.push(`mediaType: ${mediaType}`);
  lines.push(`doubanId: "${item.id}"`);
  if (cover) lines.push(`cover: ${yamlStr(cover)}`);
  if (score !== null) lines.push(`rating: ${score}`);
  if (item.year) lines.push(`year: "${item.year}"`);
  if (item.pubdate) lines.push(`year: "${item.pubdate.slice(0, 4)}"`);
  if (item.directors?.length) lines.push(`directors: [${item.directors.map(d => yamlStr(d)).join(', ')}]`);
  if (item.author) lines.push(`author: ${yamlStr(item.author)}`);
  if (tags.length) lines.push(`tags: [${tags.map(t => yamlStr(t)).join(', ')}]`);
  lines.push('draft: false');
  lines.push('source: douban');
  lines.push('---');
  lines.push('');

  if (item.comment) {
    lines.push(item.comment);
    lines.push('');
  }

  return lines.join('\n');
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
function main() {
  const raw = readFileSync(join(ROOT, 'data/douban.json'), 'utf-8');
  const db = JSON.parse(raw);

  const allItems = [
    ...(db.movies || []).map(m => ({ ...m, _type: 'movie' })),
    ...(db.books  || []).map(b => ({ ...b, _type: 'book'  })),
    ...(db.games  || []).map(g => ({ ...g, _type: 'game'  })),
  ].filter(item => item.id && item.title);

  console.log(`Total items: ${allItems.length}`);

  let created = 0, skipped = 0;

  for (const item of allItems) {
    const mediaType = item._type;
    const initial = getFirstInitial(item.title);
    const dir = join(ROOT, 'src/content/media', mediaType, initial);
    mkdirSync(dir, { recursive: true });

    // 文件名用中文标题，替换掉文件系统不允许的字符
    // 同名不同年份加年份后缀区分
    const safeName = item.title.replace(/[/\\:*?"<>|]/g, '_');
    const yearSuffix = item.year ? `_${item.year}` : '';
    const filePath = join(dir, `${safeName}${yearSuffix}.md`);

    if (existsSync(filePath)) {
      skipped++;
      continue;
    }

    const content = buildMd(item, mediaType);
    writeFileSync(filePath, content, 'utf-8');
    created++;
  }

  console.log(`Done. created=${created} skipped=${skipped}`);
}

main();
