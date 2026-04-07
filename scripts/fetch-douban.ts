/**
 * 抓取豆瓣用户标记数据，缓存为 data/douban.json
 * 用法: npx tsx scripts/fetch-douban.ts
 *
 * 抓取内容：看过的电影、读过的书、玩过的游戏
 * 不需要登录，通过 frodo API 以用户 ID 访问公开标记
 */

import crypto from 'crypto';
import { URL } from 'url';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DOUBAN_USER_ID = '199021675';

// ---------- API 签名（与 douban-mcp 一致）----------

const getFrodoSign = (url: string, date: string, method = 'GET') => {
  const urlParsed = new URL(url);
  const urlPath = urlParsed.pathname;
  const rawSign = [method.toUpperCase(), encodeURIComponent(urlPath), date].join('&');
  const hmac = crypto.createHmac('sha1', 'bf7dddc7c9cfe6f7');
  hmac.update(rawSign);
  return hmac.digest('base64');
};

const USER_AGENTS = [
  'api-client/1 com.douban.frodo/7.22.0.beta9(231) Android/23 product/Mate 40 vendor/HUAWEI model/Mate 40 brand/HUAWEI  rom/android  network/wifi  platform/AndroidPad',
  'api-client/1 com.douban.frodo/7.18.0(230) Android/22 product/MI 9 vendor/Xiaomi model/MI 9 brand/Android  rom/miui6  network/wifi  platform/mobile nd/1',
];

let _uaIdx = 0;
const getUA = () => USER_AGENTS[_uaIdx++ % USER_AGENTS.length];

const frodoFetch = async (path: string, params: Record<string, string> = {}) => {
  const fullURL = 'https://frodo.douban.com/api/v2' + path;
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  const oUrl = new URL(fullURL);
  oUrl.searchParams.set('os_rom', 'android');
  oUrl.searchParams.set('apiKey', '0dad551ec0f84ed02907ff5c42e8ec70');
  oUrl.searchParams.set('_ts', date);
  oUrl.searchParams.set('_sig', getFrodoSign(fullURL, date));
  for (const [k, v] of Object.entries(params)) oUrl.searchParams.set(k, v);

  const res = await fetch(oUrl.toString(), {
    headers: {
      'user-agent': getUA(),
      cookie: process.env.DOUBAN_COOKIE || '',
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.json();
};

// ---------- 分页抓取用户某类标记 ----------

async function fetchInterests(type: 'movie' | 'book' | 'game', status: 'done' | 'mark' | 'doing') {
  const results: any[] = [];
  let start = 0;
  const count = 50;
  let total = Infinity;

  while (start < total) {
    const data = await frodoFetch(`/user/${DOUBAN_USER_ID}/interests`, {
      type,
      status,
      start: String(start),
      count: String(count),
    });

    if (total === Infinity) total = data.total ?? 0;

    const items: any[] = data.interests || [];
    results.push(...items);

    console.log(`  ${type}: ${results.length}/${total}`);

    if (items.length === 0) break;
    start += count;

    // 礼貌延迟，避免被封
    await new Promise(r => setTimeout(r, 800));
  }

  return results;
}

// ---------- 数据转换 ----------

const HALF_STAR_RE = /^(\d(?:\.\d)?)\s*/;
const HASH_TAG_RE = /#([^\s#，。！？,]+)/g;

function parseComment(raw: string) {
  let text = raw.trim();
  // 提取开头的半星评分，如 "3.5 " 或 "4.0 "
  let halfRating: number | null = null;
  const m = text.match(HALF_STAR_RE);
  if (m) {
    const v = parseFloat(m[1]);
    if (v >= 1 && v <= 5 && (v * 10) % 5 === 0) {
      halfRating = v;
      text = text.slice(m[0].length).trim();
    }
  }
  // 提取 #tags
  const hashTags: string[] = [];
  text = text.replace(HASH_TAG_RE, (_, tag) => { hashTags.push(tag); return ''; }).trim();
  return { halfRating, hashTags, text };
}

function normalizeMovie(item: any) {
  const s = item.subject || {};
  const { halfRating, hashTags, text } = parseComment(item.comment || '');
  return {
    id: s.id,
    title: s.title,
    originalTitle: s.original_title,
    year: s.year,
    cover: s.pic?.normal || s.cover_url,
    rating: item.rating?.value ?? null,      // 豆瓣整星 1-5
    halfRating,                               // 自定义半星，覆盖整星
    comment: text,                            // 去掉评分和#tag后的正文
    hashTags,                                 // 短评里的 #tags
    genres: s.genres || [],                   // 豆瓣类型标签
    tags: [...new Set([...hashTags, ...(s.genres || [])])], // 合并去重
    markedAt: item.create_time,
    directors: (s.directors || []).map((d: any) => d.name),
    doubanUrl: s.url,
  };
}

function normalizeBook(item: any) {
  const s = item.subject || {};
  const { halfRating, hashTags, text } = parseComment(item.comment || '');
  return {
    id: s.id,
    title: s.title,
    author: (s.author || []).join('、'),
    pubdate: s.pubdate || '',
    cover: s.pic?.normal || s.cover_url,
    rating: item.rating?.value ?? null,
    halfRating,
    comment: text,
    hashTags,
    tags: [...new Set([...hashTags, ...(s.tags?.map((t: any) => t.name) || [])])],
    markedAt: item.create_time,
    publisher: s.publisher || '',
    doubanUrl: s.url,
  };
}

function normalizeGame(item: any) {
  const s = item.subject || {};
  return {
    id: s.id,
    title: s.title,
    cover: s.pic?.normal || s.cover_url,
    rating: item.rating?.value ?? null,
    comment: item.comment || '',
    markedAt: item.create_time,
    doubanUrl: s.url,
  };
}

// ---------- main ----------

async function main() {
  console.log(`Fetching Douban data for user ${DOUBAN_USER_ID}...`);

  const [movies, books, games] = await Promise.allSettled([
    fetchInterests('movie', 'done').then(items => items.map(normalizeMovie)),
    fetchInterests('book', 'done').then(items => items.map(normalizeBook)),
    fetchInterests('game', 'done').then(items => items.map(normalizeGame)),
  ]);

  const output = {
    updatedAt: new Date().toISOString(),
    userId: DOUBAN_USER_ID,
    movies: movies.status === 'fulfilled' ? movies.value : [],
    books:  books.status  === 'fulfilled' ? books.value  : [],
    games:  games.status  === 'fulfilled' ? games.value  : [],
  };

  if (movies.status === 'rejected') console.warn('Movies fetch failed:', movies.reason);
  if (books.status  === 'rejected') console.warn('Books fetch failed:',  books.reason);
  if (games.status  === 'rejected') console.warn('Games fetch failed:',  games.reason);

  const outPath = join(__dirname, '..', 'data', 'douban.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log(`Done. movies=${output.movies.length}, books=${output.books.length}, games=${output.games.length}`);
  console.log(`Saved to ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
