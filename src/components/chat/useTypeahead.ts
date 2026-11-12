import { useEffect, useRef, useState } from 'react';
import { Product } from '@/lib/types';
import { apiFetch } from '@/lib/client/api-fetch';
import { rankProducts } from '@/lib/search/product-match';

/** 候補に足すお店の製品一覧の数の上限 */
const MAX_LINEUP_CANDIDATES = 12;

/**
 * 入力途中の候補（候補トレイ）：入力のたびに保存済みの製品とブランドを探し、ブランドが分かればお店の製品一覧を取る
 */
export function useTypeahead({ input }: { input: string }) {
  // 送れなかったので入力欄に戻した文（候補を探し直さない。skipSearchFor で入れる）
  const restoredInputRef = useRef<string | null>(null);
  const [liveCandidates, setLiveCandidates] = useState<Product[]>([]);
  const [liveBrands, setLiveBrands] = useState<{ name: string; kana?: string }[]>([]);
  // 検索語の先頭のブランドと残りの語（サーバーが判定）
  const [liveBrand, setLiveBrand] = useState<{ name: string; rest: string } | null>(null);
  // お店の商品検索で作ったブランドの製品一覧。このページを開いている間だけ持つ（サーバーには保存しない。楽天の規約）
  const [lineups, setLineups] = useState<Record<string, { products: Product[]; credits: ('rakuten' | 'yahoo')[] }>>({});
  const lineupRequested = useRef(new Set<string>());
  // 取れなかったブランドは、この時刻まで取り直さない（入力のたびに呼ばない）
  const lineupRetryAt = useRef(new Map<string, number>());
  const [isTrayOpen, setIsTrayOpen] = useState(false);

  /** ブランドの製品一覧をお店の商品検索から1回だけ取る（同じブランドはこのページを開いている間は取り直さない） */
  const requestLineup = (brand: string) => {
    if (lineupRequested.current.has(brand)) return;
    if ((lineupRetryAt.current.get(brand) ?? 0) > Date.now()) return;
    lineupRequested.current.add(brand);
    const fail = () => {
      // 30秒たってから、このブランドが入力されたときにもう一度取る
      lineupRequested.current.delete(brand);
      lineupRetryAt.current.set(brand, Date.now() + 30_000);
    };
    apiFetch(`/api/products/lineup?brand=${encodeURIComponent(brand)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || !Array.isArray(data.products)) {
          fail();
          return;
        }
        const credits = Array.isArray(data.credits) ? data.credits.filter((c: unknown) => c === 'rakuten' || c === 'yahoo') : [];
        setLineups((prev) => ({ ...prev, [brand]: { products: data.products, credits } }));
      })
      .catch(fail);
  };

  useEffect(() => {
    const trimmed = input.trim();
    // 入力が空のときは何もしない（候補トレイは描画側で入力が空なら非表示にする）
    if (!trimmed) return;
    // 送れなかった文を入力欄に戻したときは、候補を探し直さない（失敗の吹き出しの上に候補を出さない）
    if (restoredInputRef.current === input) {
      restoredInputRef.current = null;
      return;
    }

    // 高頻度API & Google検索への非同期問い合わせ（300msデバウンス）
    // 入力が変わったら前のリクエストを中断し、古い結果で新しい結果を上書きしないようにする
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/products/search?q=${encodeURIComponent(trimmed)}&limit=6`, {
          signal: controller.signal,
        });
        if (res.ok) {
          const data = await res.json();
          // 入力が変わった後に届いた古い応答は使わない（古いブランドの一覧を取りに行かない）
          if (controller.signal.aborted) return;
          if (Array.isArray(data.results)) {
            // 0件のときも入れ替える（前の入力の候補を残さない）
            const brands = Array.isArray(data.brands) ? data.brands : [];
            setLiveCandidates(data.results);
            setLiveBrands(brands);
            const brand =
              data.brand && typeof data.brand.name === 'string' && typeof data.brand.rest === 'string' ? data.brand : null;
            setLiveBrand(brand);
            if (brand) requestLineup(brand.name);
            if (data.results.length > 0 || brands.length > 0 || brand) setIsTrayOpen(true);
          }
        }
      } catch {
        // 中断・オフライン時は表示中の候補を維持
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [input]);

  // 候補：保存済みの製品（サーバーの結果）の後に、お店の製品一覧を残りの語で絞り込んだもの
  const lineup = liveBrand ? lineups[liveBrand.name] : undefined;
  const lineupMatches = lineup
    ? (liveBrand!.rest ? rankProducts(lineup.products, liveBrand!.rest) : lineup.products)
        .filter((p) => !liveCandidates.some((c) => c.id === p.id))
        .slice(0, MAX_LINEUP_CANDIDATES)
    : [];
  const trayCandidates = [...liveCandidates, ...lineupMatches];
  // お店の製品一覧のクレジットに、Yahoo! の商品説明から成分を読んだ保存済みの製品を出すときの Yahoo! のクレジットを足す
  // （LINEヤフーのクレジットの表示のガイドライン：API のデータを出すところに出す）
  const lineupCredits = lineupMatches.length > 0 && lineup ? lineup.credits : [];
  const trayCredits: ('rakuten' | 'yahoo')[] =
    liveCandidates.some((p) => p.ingredientSource === 'shop_yahoo') && !lineupCredits.includes('yahoo')
      ? [...lineupCredits, 'yahoo']
      : lineupCredits;
  const isTrayVisible = isTrayOpen && (trayCandidates.length > 0 || liveBrands.length > 0) && input.trim() !== '';

  /** 入力を消したとき：トレイを閉じ、前の検索候補を破棄する（次の入力で古い候補が一瞬表示されないように） */
  const clearCandidates = () => {
    setIsTrayOpen(false);
    setLiveCandidates([]);
  };

  /** 送れなかった文を入力欄に戻すとき：その文では候補を探し直さない（失敗の吹き出しの上に候補を出さない） */
  const skipSearchFor = (text: string) => {
    restoredInputRef.current = text;
  };

  return { liveBrands, trayCandidates, trayCredits, isTrayVisible, setIsTrayOpen, clearCandidates, skipSearchFor };
}
