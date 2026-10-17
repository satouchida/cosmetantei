import { Product } from './types';

/**
 * 製品カードに出す「出典」（成分表示をどこで確かめたか）。docs/plans/gemini-role-redesign.md の Phase 7
 * - Web ページ: 読み取ったページへのリンク（https のみ）
 * - Open Beauty Facts: 製品ページへのリンク（データベースのライセンスで出典の表示が必要）
 * - パッケージの入力・AI の推定: リンクなし
 * - アプリの収録データ: 出さない
 */
export interface ProductSourceInfo {
  label: string;
  href?: string;
  /** Web 検索で見つけたページから読み取った */
  fromWebSearch: boolean;
}

const OPEN_BEAUTY_FACTS_PRODUCT = 'https://world.openbeautyfacts.org/product/';

function httpsUrl(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return null;
    // URL に埋め込まれた認証情報はリンクに含めない
    u.username = '';
    u.password = '';
    return u;
  } catch {
    return null;
  }
}

export function productSourceInfo(p: Product): ProductSourceInfo | null {
  switch (p.ingredientSource) {
    case 'web_page': {
      const u = httpsUrl(p.sourceUrl);
      return u
        ? { label: u.hostname.replace(/^www\./, ''), href: u.href, fromWebSearch: true }
        : { label: 'Webページ', fromWebSearch: true };
    }
    case 'open_beauty_facts':
      return {
        label: 'Open Beauty Facts',
        href: p.barcode && /^\d{8,14}$/.test(p.barcode) ? `${OPEN_BEAUTY_FACTS_PRODUCT}${p.barcode}` : undefined,
        fromWebSearch: false,
      };
    case 'user_label':
      return { label: 'パッケージの成分表示（入力）', fromWebSearch: false };
    case 'ai_estimate':
      return { label: 'AIによる推定', fromWebSearch: false };
    default:
      return null;
  }
}

/**
 * ユーザーが入力・撮影した成分表示の製品か。この見分け方はここだけに書く：
 * 共有のキャッシュに入れない（cosmetics-db の isShareable）・ブラウザに保存しない（current-use の isPersistable）・
 * 成分を AI にまとめて送らない（ai-analysis・分析カード）
 */
export function isUserLabelProduct(p: Product): boolean {
  return p.ingredientSource === 'user_label' || p.id.startsWith('label_');
}
