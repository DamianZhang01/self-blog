import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const tech = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/tech' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    description: z.string().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

const media = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/media' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    description: z.string().optional(),
    tags: z.array(z.string()).default([]),
    mediaType: z.enum(['book', 'movie', 'music', 'game']).optional(),
    doubanId: z.string().optional(),
    cover: z.string().optional(),
    rating: z.number().min(1).max(5).optional(),
    author: z.string().optional(),
    year: z.string().optional(),
    draft: z.boolean().default(false),
    source: z.enum(['douban', 'manual']).default('manual'),
  }),
});

export const collections = { tech, media };
