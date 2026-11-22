'use client';

import React from 'react';
import { AlertCircle, AlertTriangle, Globe, HelpCircle, ShieldCheck } from 'lucide-react';
import { ProductAnalysisResult } from '@/lib/types';
import { brandLine } from '@/lib/display-brand';
import { ProductSourceLink } from './ProductSourceLink';
import { badge as badgeClass, type Tone } from '../ui/design';

interface AnalysisCardHeaderProps {
  product: ProductAnalysisResult['product'];
  /** Web で集めた成分データ（バッジを出す） */
  isEstimatedFromMarketplaces: ProductAnalysisResult['isEstimatedFromMarketplaces'];
  overallRiskLevel: ProductAnalysisResult['overallRiskLevel'];
  /** 日本の化粧品基準で配合できない成分がある（緑の見出しにしない） */
  outsideJpStandard: ProductAnalysisResult['outsideJpStandard'];
}

/** 分析カードの上部：ブランド、製品名、出典、総合判定のバッジ */
export const AnalysisCardHeader: React.FC<AnalysisCardHeaderProps> = ({
  product,
  isEstimatedFromMarketplaces,
  overallRiskLevel,
  outsideJpStandard,
}) => {
  const getOverallBadge = (): { title: string; tone: Tone; icon: typeof ShieldCheck } => {
    switch (overallRiskLevel) {
      case 'safe':
        // 日本の化粧品基準で配合できない成分があるときは、緑の見出しにしない（成分の注意は下の欄に出る）
        if (outsideJpStandard) return { title: '日本の化粧品基準の注意あり', tone: 'neutral', icon: AlertCircle };
        return { title: '刺激になりやすい成分なし（目安）', tone: 'safe', icon: ShieldCheck };
      case 'caution':
        return { title: '敏感肌はやや注意', tone: 'caution', icon: AlertTriangle };
      case 'warning':
        return { title: '刺激・アレルゲン成分あり', tone: 'warning', icon: AlertCircle };
      case 'insufficient_data':
        return { title: '成分データ不足で判定できません', tone: 'neutral', icon: HelpCircle };
    }
  };

  const badge = getOverallBadge();
  const IconComponent = badge.icon;

  return (
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 pb-3 border-b border-sand-200">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-semibold text-sage-700">{brandLine(product)}</span>
          {isEstimatedFromMarketplaces && (
            <span className={badgeClass('brand')}>
              <Globe className="w-3 h-3" aria-hidden />
              <span>Web探索成分データ</span>
            </span>
          )}
        </div>
        <h2 className="text-lg font-semibold text-ink leading-snug mt-0.5 break-keep [overflow-wrap:anywhere]">
          {product.name}
        </h2>
        <ProductSourceLink product={product} className="mt-1" />
      </div>
      <div className={`self-start ${badgeClass(badge.tone, 'large')}`}>
        <IconComponent className="w-4 h-4" aria-hidden />
        <span>{badge.title}</span>
      </div>
    </div>
  );
};
