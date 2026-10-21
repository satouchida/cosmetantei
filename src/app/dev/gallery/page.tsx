import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { analyzeProduct, checkCurrentUse, performDifferentialAnalysis } from '@/lib/analyzer/ingredient-analyzer';
import {
  longJapanese,
  longLatinName,
  melano,
  retinolSerum,
  routineProducts,
  salicylicToner,
} from '@/lib/dev/gallery-fixtures';
import { Gallery } from './Gallery';

export const metadata: Metadata = { title: '画面一覧（開発用）', robots: { index: false } };

/**
 * 開発用：すべての画面を見本のデータで出す（API を呼ばない）。画面の幅ごとの崩れを、目と
 * scripts/check-responsive.mjs で確かめるため。開発（next dev）以外では 404（docs/plans/responsive-design.md）
 */
export default async function GalleryPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // 開発のときだけ開く（production 以外の値で動く環境でも出さない）
  if (process.env.NODE_ENV !== 'development') notFound();
  const { screen } = await searchParams;

  // 分析の結果は、本物の分析（ルールだけで動き、API を呼ばない）で作る。型を変えても見本が古くならない
  const results = {
    analysis: analyzeProduct(melano),
    analysisLong: analyzeProduct(longJapanese),
    analysisLatin: analyzeProduct(longLatinName),
    differential: performDifferentialAnalysis(routineProducts.bad, routineProducts.safe),
    differentialBadOnly: performDifferentialAnalysis([melano], []),
    currentUse: checkCurrentUse([retinolSerum, salicylicToner]),
  };

  return <Gallery screen={typeof screen === 'string' ? screen : undefined} results={results} />;
}
