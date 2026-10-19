import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

/** ページは1つだけ。更新日は書かない（実際の更新日を持っていないため） */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${SITE_URL}/`, changeFrequency: 'weekly', priority: 1 }];
}
