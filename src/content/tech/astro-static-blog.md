---
title: 用 Astro 搭建静态博客的体验
date: 2026-03-15
description: 从零开始用 Astro 搭一个博客，顺便聊聊静态站点生成的思路
tags: [Astro, 前端, 工具]
---

## 为什么选 Astro

最近一直在找一个合适的博客方案。试过 Hugo，速度确实快，但 Go 模板语法让我有点头疼。Next.js 太重，用来写博客感觉像用卡车拉菜。

Astro 的设计理念正好对上了——它的核心思路是"默认发送零 JavaScript"，对于一个以内容为主的博客来说，这是正确的起点。

## 内容集合

Astro 的 Content Collections 是目前用过最顺手的 Markdown 管理方案。在 `content.config.ts` 里定义 schema，写文章时 frontmatter 会有类型提示和校验，少了很多低级错误。

```ts
const tech = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/tech' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    tags: z.array(z.string()).default([]),
  }),
});
```

## 部署

配合 GitHub Actions，push 之后自动构建部署到 GitHub Pages，整个流程大概一分钟。静态文件、免费、无服务器，对个人博客来说已经够了。

---

目前这个博客还在搭建阶段，后续会慢慢写起来。

## 踩坑记录

### `base` 路径拼接：函数内 `import.meta.env.BASE_URL` 失效

Astro 配置了 `base: '/self-blog/'` 后，`import.meta.env.BASE_URL` 在模板的顶层表达式（如 `` `${base}media` ``）里会被 Vite 正确替换，但**在函数体内部不会替换**——函数调用时 `base` 变量或 `import.meta.env.BASE_URL` 都会变成空字符串。

```ts
// ❌ 不生效：函数内的 import.meta.env.BASE_URL 不会被替换
function buildSrc(id: string) {
  return import.meta.env.BASE_URL + 'covers/' + id;
}

// ✅ 正确：在 frontmatter 顶层预先计算好，存进数组
const items = raw.map(item => ({
  ...item,
  coverInitial: getInitial(item.title[0]),
  coverExt: item.cover.split('.').pop(),
}));

// 然后在模板里直接用 import.meta.env.BASE_URL 内联拼接
// src={`${import.meta.env.BASE_URL}covers/${item.mediaType}/${item.coverInitial}/...`}
```

根本原因：Vite 的 `define` 替换是静态文本替换，只处理直接出现在源码中的 `import.meta.env.BASE_URL` 表达式，不追踪赋值给变量后的传递路径。

### `base` 末尾斜杠

`astro.config.mjs` 里 `base` 不带尾斜杠时（`/self-blog`），`import.meta.env.BASE_URL` 的值也不带尾斜杠，拼接 `${base}media` 会变成 `/self-blogmedia`。

```js
// ✅
base: '/self-blog/',
```

### Content Collection 被豆瓣 md 污染

把豆瓣数据批量生成为 md 文件放进 `src/content/media/` 后，`getCollection('media')` 会把所有 1400+ 条豆瓣记录都读进来，在"长文"区域渲染，严重影响排序和展示。

解决方式：在 schema 加 `source` 字段，生成的 md 写 `source: douban`，手写文章默认 `source: manual`，读取时过滤：

```ts
// content.config.ts
source: z.enum(['douban', 'manual']).default('manual'),

// 列表页只取手写文章
getCollection('media', ({ data }) => !data.draft && data.source !== 'douban')
```

### YAML frontmatter 中的数字标题

标题为纯数字（如《1917》）时，YAML 会把 `title: 1917` 解析为 number 而非 string，导致 Astro schema 校验报错。生成 md 时需要对纯数字标题加引号：

```js
// 检测纯数字并加双引号
if (/^[\d.]+$/.test(s)) return `"${s}"`;
```

### `astro preview` 的 base 路径行为与生产不同

`astro preview` 在本地 serve 时会去掉 `base` 前缀，导致图片路径 `/self-blog/covers/...` 在 preview 环境下变成 `/covers/...` 请求失败。这是 preview 的已知行为，**实际部署到 GitHub Pages 后路径是正确的**，不用纠结 preview 里的图片问题。
