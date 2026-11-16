'use client';

import React from 'react';
import { Trash2 } from 'lucide-react';
import type { Product } from '@/lib/types';

interface ProductRowProps {
  product: Product;
  /** 左の線の色 */
  accentClassName: string;
  /** ブランド名の色 */
  brandClassName: string;
  onRemove: () => void;
  /** 削除ボタンの名前（製品名とリストの名前を入れる） */
  removeLabel: string;
  /** 製品名の下の一言（追加した日など） */
  note?: React.ReactNode;
  /** 行の下に置く操作（今も使っているかのスイッチなど） */
  children?: React.ReactNode;
}

/** リストの製品1つ：ブランド、製品名、削除ボタン */
export const ProductRow: React.FC<ProductRowProps> = ({
  product,
  accentClassName,
  brandClassName,
  onRemove,
  removeLabel,
  note,
  children,
}) => (
  <div className={`bg-white pl-3 pr-1 py-2 rounded-xl border border-sand-200 border-l-[3px] shadow-xs ${accentClassName}`}>
    <div className="flex items-start justify-between gap-1">
      <div className="min-w-0 flex-1 py-1">
        <div className={`text-xs font-semibold truncate ${brandClassName}`}>{product.brand}</div>
        <div className="text-sm font-semibold text-ink break-keep [overflow-wrap:anywhere] line-clamp-2">
          {product.name}
        </div>
        {note}
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className="w-12 h-12 shrink-0 flex items-center justify-center rounded-full text-gray-500 hover:text-rose-700 hover:bg-tint-warning active:bg-rose-100 transition-colors"
      >
        <Trash2 className="w-5 h-5" aria-hidden />
      </button>
    </div>
    {children && <div className="pr-2">{children}</div>}
  </div>
);
