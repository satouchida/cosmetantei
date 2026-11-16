'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { Product } from '@/lib/types';
import { SectionHeading } from './SectionHeading';
import { EmptyState } from './EmptyState';
import { ProductRow } from './ProductRow';
import { ClearButton } from './ClearButton';

interface BadProductsSectionProps {
  /** 見出しの ID（RoutineSidebar の BAD_SECTION_ID） */
  id: string;
  badProducts: Product[];
  onRemoveBad: (productId: string) => void;
  /** リストをクリアする（確かめるダイアログを開く） */
  onClearBad: () => void;
}

/** 肌荒れしたコスメのリスト（このページを開いている間だけ） */
export const BadProductsSection: React.FC<BadProductsSectionProps> = ({ id, badProducts, onRemoveBad, onClearBad }) => (
  <section id={id} className="space-y-2">
    <SectionHeading
      icon={<AlertTriangle className="w-4 h-4 text-rose-600" aria-hidden />}
      title="肌荒れしたコスメ"
      count={badProducts.length}
      countClassName="bg-tint-warning text-rose-700"
    />

    {badProducts.length === 0 ? (
      <EmptyState>チャットでコスメを検索、またはバーコードを読み取って追加</EmptyState>
    ) : (
      <>
        <ul role="list" className="space-y-2">
          {badProducts.map((p) => (
            <li key={p.id}>
              <ProductRow
                product={p}
                accentClassName="border-l-rose-600"
                brandClassName="text-rose-700"
                onRemove={() => onRemoveBad(p.id)}
                removeLabel={`「${p.name}」を肌荒れしたコスメから削除`}
              />
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-muted">このリストは保存しません。ページを閉じると消えます。</p>
        <ClearButton onClick={onClearBad}>肌荒れしたコスメのリストをクリア</ClearButton>
      </>
    )}
  </section>
);
