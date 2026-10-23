'use client';

import React from 'react';
import type { CurrentUseCheckResult, DifferentialAnalysisResult, ProductAnalysisResult } from '@/lib/types';
import { LiveSearchCandidateTray } from '@/components/search/LiveSearchCandidateTray';
import { ProductSuggestionCard } from '@/components/chat/ProductSuggestionCard';
import { IngredientAnalysisCard } from '@/components/chat/IngredientAnalysisCard';
import { DifferentialResultCard } from '@/components/chat/DifferentialResultCard';
import { CurrentUseResultCard } from '@/components/chat/CurrentUseResultCard';
import { PriceResultCard } from '@/components/chat/PriceResultCard';
import { AmazonAlternativeCard } from '@/components/chat/AmazonAlternativeCard';
import { RoutineSidebar } from '@/components/routine/RoutineSidebar';
import { RoutineExportDialog } from '@/components/routine/RoutineExportDialog';
import { RoutineImportDialog } from '@/components/routine/RoutineImportDialog';
import { LabelInputModal } from '@/components/label/LabelInputModal';
import { BarcodeScannerModal } from '@/components/scanner/BarcodeScannerModal';
import { ConsentDialog } from '@/components/legal/ConsentDialog';
import { withHiddenEmoji } from '@/components/ui/emoji';
import {
  rakutenListing,
  curel,
  currentUseEntries,
  ihada,
  longJapanese,
  longLatinName,
  melano,
  noIngredients,
  priceOk,
  priceUnavailable,
  routineProducts,
  salicylicToner,
  shopProducts,
} from '@/lib/dev/gallery-fixtures';

export interface GalleryResults {
  analysis: ProductAnalysisResult;
  analysisLong: ProductAnalysisResult;
  analysisLatin: ProductAnalysisResult;
  analysisStandard: ProductAnalysisResult;
  differential: DifferentialAnalysisResult;
  differentialBadOnly: DifferentialAnalysisResult;
  currentUse: CurrentUseCheckResult;
}

const noop = () => {};
// 見本の画面を出すたびに変わらないよう、日時は固定する
const NOW = Date.parse('2026-10-21T09:00:00+09:00');

/** チャットの返信の吹き出し（ChatContainer と同じ幅・余白。結果のカードは幅いっぱい） */
function Bubble({ children, card = true }: { children: React.ReactNode; card?: boolean }) {
  return (
    <div className="flex gap-3 justify-start">
      <div className="w-8 h-8 rounded-full bg-primary shrink-0 mt-0.5" aria-hidden />
      <div
        className={`${card ? 'min-w-0 flex-1 max-w-[720px]' : 'max-w-[88%] sm:max-w-[75%]'} rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-xs bg-white text-ink rounded-tl-sm border border-sand-200`}
      >
        {children}
      </div>
    </div>
  );
}

const cardHandlers = {
  onSelectToAnalyze: noop,
  onAddToBad: noop,
  onAddToSafe: noop,
  onAddToCurrent: noop,
};

const sidebarHandlers = {
  onRemoveBad: noop,
  onRemoveSafe: noop,
  onRemoveCurrent: noop,
  onConfirmCurrent: noop,
  onCheckCurrentUse: noop,
  onRunDifferential: noop,
  onLoadPreset: noop,
  onExportImage: noop,
  onImportImage: noop,
  onClose: noop,
};

function screens(r: GalleryResults): { id: string; title: string; layout?: 'chat' | 'full'; render: () => React.ReactNode }[] {
  const snapshot = {
    badProducts: routineProducts.bad,
    safeProducts: routineProducts.safe,
    currentUse: currentUseEntries(NOW),
  };
  const tray = (props: Partial<React.ComponentProps<typeof LiveSearchCandidateTray>>) => (
    <div className="max-w-[720px] mx-auto">
      <LiveSearchCandidateTray
        query="無印良品"
        candidates={[]}
        isOpen
        onClose={noop}
        onSelectProduct={noop}
        onAddToBad={noop}
        onAddToSafe={noop}
        onAddToCurrent={noop}
        {...props}
      />
    </div>
  );

  return [
    {
      id: 'tray-shop',
      title: '候補トレイ：お店の商品9件（PR・クレジット）',
      render: () =>
        tray({
          candidates: shopProducts,
          brands: [{ name: '無印良品', kana: 'むじるしりょうひん' }],
          onSelectBrand: noop,
          credits: ['rakuten', 'yahoo'],
        }),
    },
    {
      id: 'tray-db',
      title: '候補トレイ：成分の分かる製品（バッジ・長い名前）',
      render: () =>
        tray({
          query: 'HyaluronicAcidCeramideNiacinamidePanthenolBarrierRepairIntensiveMoisturizingSerum',
          candidates: [melano, longJapanese, longLatinName, curel, noIngredients],
        }),
    },
    {
      id: 'tray-brands',
      title: '候補トレイ：ブランドだけ',
      render: () =>
        tray({
          query: 'ら',
          brands: [
            { name: 'ラ ロッシュ ポゼ', kana: 'らろっしゅぽぜ' },
            { name: 'ランコム', kana: 'らんこむ' },
            { name: 'SuperLongBrandNameWithoutAnySpacesCosmetics' },
          ],
          onSelectBrand: noop,
        }),
    },
    {
      id: 'chat-text',
      title: 'チャット：長い文・URL・空白のない英字',
      layout: 'chat',
      render: () => (
        <Bubble card={false}>
          <p className="whitespace-pre-wrap">
            {withHiddenEmoji(
              '🔍 「HyaluronicAcidCeramideNiacinamidePanthenolBarrierRepairIntensiveMoisturizingSerum」の成分は、https://example.com/products/very/long/path/to/the/product/page?with=query&and=more&parameters=1 で確認できます。'
            )}
          </p>
        </Bubble>
      ),
    },
    {
      id: 'suggestions',
      title: '製品の候補カード',
      layout: 'chat',
      render: () => (
        <Bubble>
          <ProductSuggestionCard products={[melano, longJapanese, longLatinName, noIngredients]} {...cardHandlers} />
        </Bubble>
      ),
    },
    {
      id: 'suggestions-shop-listing',
      title: '製品の候補カード（楽天の商品説明の出典・PR）',
      layout: 'chat',
      render: () => (
        <Bubble>
          <ProductSuggestionCard products={[rakutenListing, melano]} {...cardHandlers} />
        </Bubble>
      ),
    },
    {
      id: 'suggestions-alternatives',
      title: '代わりの商品（お店の商品・PR・クレジット）',
      layout: 'chat',
      render: () => (
        <Bubble>
          <ProductSuggestionCard
            products={shopProducts.slice(0, 4)}
            isAlternatives
            credits={['rakuten', 'yahoo']}
            {...cardHandlers}
          />
        </Bubble>
      ),
    },
    {
      id: 'analysis',
      title: '成分の分析（医薬部外品）',
      layout: 'chat',
      render: () => (
        <Bubble>
          <IngredientAnalysisCard
            analysis={r.analysis}
            onAddToBadRoutine={noop}
            onAddToSafeRoutine={noop}
            onAddToCurrentRoutine={noop}
            onFindAlternatives={noop}
          />
        </Bubble>
      ),
    },
    {
      id: 'analysis-long',
      title: '成分の分析（長い名前・多い成分）',
      layout: 'chat',
      render: () => (
        <div className="space-y-4">
          <Bubble>
            <IngredientAnalysisCard analysis={r.analysisLong} onAddToBadRoutine={noop} onAddToSafeRoutine={noop} onAddToCurrentRoutine={noop} />
          </Bubble>
          <Bubble>
            <IngredientAnalysisCard analysis={r.analysisLatin} onAddToBadRoutine={noop} onAddToSafeRoutine={noop} onAddToCurrentRoutine={noop} />
          </Bubble>
        </div>
      ),
    },
    {
      id: 'analysis-standard',
      title: '成分の分析（日本の化粧品基準の注意・表示指定成分）',
      layout: 'chat',
      render: () => (
        <Bubble>
          <IngredientAnalysisCard
            analysis={r.analysisStandard}
            onAddToBadRoutine={noop}
            onAddToSafeRoutine={noop}
            onAddToCurrentRoutine={noop}
            onFindAlternatives={noop}
          />
        </Bubble>
      ),
    },
    {
      id: 'differential',
      title: '差分分析の結果',
      layout: 'chat',
      render: () => (
        <div className="space-y-4">
          <Bubble>
            <DifferentialResultCard result={r.differential} />
          </Bubble>
          <Bubble>
            <DifferentialResultCard result={r.differentialBadOnly} />
          </Bubble>
        </div>
      ),
    },
    {
      id: 'current-use',
      title: '今使っているコスメの組み合わせ',
      layout: 'chat',
      render: () => (
        <Bubble>
          <CurrentUseResultCard result={{ ...r.currentUse, staleProductNames: [salicylicToner.name] }} />
        </Bubble>
      ),
    },
    {
      id: 'price',
      title: '価格（取れた・取れなかった）',
      layout: 'chat',
      render: () => (
        <div className="space-y-4">
          <Bubble>
            <PriceResultCard result={priceOk} />
          </Bubble>
          <Bubble>
            <PriceResultCard result={priceUnavailable} />
          </Bubble>
        </div>
      ),
    },
    {
      id: 'amazon-alternatives',
      title: 'Amazon の代わりの商品',
      layout: 'chat',
      render: () => (
        <Bubble>
          <AmazonAlternativeCard products={[curel, ihada, longJapanese]} avoidedIngredients={['香料', 'エタノール']} />
        </Bubble>
      ),
    },
    {
      id: 'sidebar-empty',
      title: 'マイルーティン（空）',
      layout: 'full',
      render: () => (
        <div className="h-dvh w-full max-w-[420px] lg:w-80 border-r border-sand-200">
          <RoutineSidebar
            routine={{ badProducts: [], safeProducts: [], currentlyUsing: [] }}
            currentUse={[]}
            staleIds={new Set()}
            closeButtonRef={{ current: null }}
            {...sidebarHandlers}
          />
        </div>
      ),
    },
    {
      id: 'sidebar-full',
      title: 'マイルーティン（長い名前・古い追加）',
      layout: 'full',
      render: () => (
        <div className="h-dvh w-full max-w-[420px] lg:w-80 border-r border-sand-200">
          <RoutineSidebar
            routine={{ badProducts: routineProducts.bad, safeProducts: routineProducts.safe, currentlyUsing: [] }}
            currentUse={snapshot.currentUse}
            staleIds={new Set([salicylicToner.id])}
            closeButtonRef={{ current: null }}
            {...sidebarHandlers}
          />
        </div>
      ),
    },
    {
      id: 'dialog-label',
      title: '成分表示の入力',
      layout: 'full',
      render: () => <LabelInputModal isOpen onClose={noop} onSubmit={async () => true} />,
    },
    {
      id: 'dialog-export',
      title: '画像で保存・共有',
      layout: 'full',
      render: () => <RoutineExportDialog snapshot={snapshot} culprits={['香料', 'エタノール', 'o-シメン-5-オール']} onClose={noop} />,
    },
    {
      id: 'dialog-import',
      title: 'マイルーティンを読み込む',
      layout: 'full',
      render: () => (
        <RoutineImportDialog snapshot={snapshot} namesOnly={false} hasCurrentLists typedLabelsLost={2} onImport={noop} onClose={noop} />
      ),
    },
    {
      id: 'dialog-consent',
      title: 'ご利用の前に（同意）',
      layout: 'full',
      render: () => <ConsentDialog />,
    },
    {
      id: 'scanner',
      title: 'バーコードの読み取り（カメラが無いときの表示）',
      layout: 'full',
      render: () => <BarcodeScannerModal isOpen onClose={noop} onScanSuccess={() => true} />,
    },
  ];
}

export function Gallery({ screen, results }: { screen?: string; results: GalleryResults }) {
  const all = screens(results);
  const current = all.find((s) => s.id === screen);

  if (!current) {
    return (
      <main className="min-h-dvh bg-surface px-4 py-6 max-w-[720px] mx-auto">
        <h1 className="text-lg font-semibold text-ink">画面一覧（開発用）</h1>
        <p className="mt-1 text-sm text-ink-muted">見本のデータで出します（API は呼びません）。</p>
        <ul className="mt-4 space-y-1">
          {all.map((s) => (
            <li key={s.id}>
              <a data-screen={s.id} href={`?screen=${s.id}`} className="inline-flex min-h-11 items-center text-sage-700 underline">
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </main>
    );
  }

  if (current.layout === 'full') return <div data-gallery-screen={current.id}>{current.render()}</div>;
  return (
    <main data-gallery-screen={current.id} className="min-h-dvh bg-surface px-3 py-4 sm:p-6">
      <div className="max-w-[720px] mx-auto space-y-4">{current.render()}</div>
    </main>
  );
}
