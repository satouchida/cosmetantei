import { Product } from '../types';
import { isStoredSource } from '../data/cosmetics-db';
import { getDisplayBrand as getDisplayBrandWith } from '../display-brand';
import { isGenericCosmeticTerm, isNonCosmeticSearchQuery } from './query-check';

/** 候補が実在の化粧品か（架空・検索語だけの候補を出さない）と、表示するブランド名 */

/**
 * UI表示用の安全なブランド名取得
 * - 万が一一般名詞や不正ワードが入っていた場合でも、商品名や安全な表記にフォールバック
 */
export function getDisplayBrand(brand?: string, name?: string): string {
  return getDisplayBrandWith(brand, name, isGenericCosmeticTerm);
}

/**
 * 実際の化粧品製品名（コスメ・スキンケア・メイクアイテム）であるかの厳格判定
 * - 架空のブランド名やプレースホルダーは厳格に除外
 * - 単なる検索クエリや疑問文、架空テンプレートは厳格に除外
 * - ブランド名が一般名詞・検索ワードであるものは厳格に除外
 */
export function isActualCosmeticProduct(p: Product | string): boolean {
  if (!p) return false;

  const text = typeof p === 'string' ? p : `${p.brand} ${p.name}`;
  if (!text) return false;

  // 1. ノイズワードが含まれていれば即NG
  if (isNonCosmeticSearchQuery(text)) return false;

  if (typeof p !== 'string') {
    if (isNonCosmeticSearchQuery(p.name) || isNonCosmeticSearchQuery(p.brand)) {
      return false;
    }

    // ブランド名が一般名詞である場合は即NG（Gemini判断）
    if (isGenericCosmeticTerm(p.brand)) {
      return false;
    }

    // 架空ブランド・プレースホルダーの厳格除外
    const FAKE_BRANDS =
      /^(注目コスメ|注目スキンケア|薬用スキンケア|低刺激ラボ|酵素洗顔|ディープクリア|バーコード照合|ブランド未記載|未記載|モイストリップ|プランプケア|カラーケア|無添加ラボ)$/i;
    if (FAKE_BRANDS.test(p.brand.trim())) {
      return false;
    }

    // 架空製品名・テンプレート名・アイテム連番の厳格除外
    const FAKE_NAMES =
      /(炭＆植物スクラブ|薬用 炭クレイ スクラブ|ディープクリア 炭スクラブ|低刺激 炭スクラブ|酵素＆炭スクラブ|アイテム\d+|アイテム \d+)/i;
    if (FAKE_NAMES.test(p.name)) {
      return false;
    }

    // ブランド名と商品名が同一で、かつ単なる一般カテゴリ名の場合
    if (p.brand === p.name && (/^(洗顔|化粧水|乳液|クリーム|美容液|リップ|日焼け止め)$/i.test(p.name) || ENGLISH_BARE.test(p.name.trim()))) {
      return false;
    }

    // 全成分を確かめた製品で、分類が分かっているもの。製品名に分類の語が無くてもよい
    // （「SPステイ マットインク」は分類 lip。2026-11-07 のログ）
    if (p.category !== 'other' && hasVerifiedIngredientList(p)) return true;
  }

  // 2. 単一カテゴリのみの場合もNG
  const bareQuery = text.trim().toLowerCase();
  if (
    /^(リップ|口紅|洗顔|化粧水|乳液|クリーム|美容液|日焼け止め|ファンデーション|コスメ|スキンケア)$/.test(
      bareQuery
    )
  ) {
    return false;
  }

  // 3. 化粧品カテゴリー、剤形、または実在コスメ製品シリーズ名が含まれていること
  const cosmeticSignature =
    /(化粧水|ローション|トナー|スキン|乳液|ミルク|エマルジョン|クリーム|フェイスクリーム|バーム|美容液|セラム|エッセンス|アンプル|オイル|パック|マスク|シートマスク|ジェル|洗顔|泡洗顔|洗顔料|洗顔フォーム|クレンジング|メイク落とし|石鹸|せっけん|スクラブ|日焼け止め|日やけ止め|uv|サンプロテクト|サンクリーム|下地|化粧下地|ファンデーション|ファンデ|bbクリーム|ccクリーム|コンシーラー|パウダー|おしろい|リップ|口紅|ルージュ|ティント|リップバーム|リップクリーム|リップグロス|リッププランパー|アイシャドウ|マスカラ|アイライナー|アイブロウ|眉マスカラ|チーク|ハイライト|シェーディング|ネイル|モンスター|メラノcc|シカプラスト|パーフェクトホイップ|クリアフル|白潤|極潤|オバジc|ダイブイン|リードルショット)/i;

  // 英語の製品名（海外・ブランドのグローバルサイトのページ。例: 「Moisturizing Lip Creator (TINT)」）
  if (cosmeticSignature.test(text) || isEnglishCosmeticName(text)) {
    return true;
  }

  return false;
}

/** 英語で化粧品とはっきり分かる語 */
const ENGLISH_STRONG =
  /\b(lip(?:s|stick|\s*balm|\s*gloss)?|baume|lotions?|serums?|ampoules?|moisturi[sz](?:ers?|ing)|cleansers?|cleansing|face\s*wash|sunscreens?|sunblock|spf\s*\d*|mascara|eye\s*liner|eyeliner|eye\s*shadow|eyeshadow|eyebrow|concealer|highlighter|blush)\b/i;
/** 化粧品以外にも使う語（印刷のトナー・食品のパウダー・工具のネイル等）。肌・美容の語と一緒のときだけ数える */
const ENGLISH_WEAK =
  /\b(tint|balm|toner|essence|cream|emulsion|foam|primer|foundation|cushion|powder|mask|gel|mist|oil|nail|brow)s?\b/i;
const ENGLISH_BEAUTY_CONTEXT =
  /\b(skin|face|facial|hair|beauty|cosmetics?|make-?up|hydrating|moisturi[sz]\w*|anti-?aging|whitening|brightening|cica|sheet)\b/i;
/** カテゴリ名の単語だけ（商品名が無い） */
const ENGLISH_BARE = /^(lip|lips|serum|toner|cream|lotion|mask|gel|oil|essence|mist|foam|balm|tint)s?$/i;

function isEnglishCosmeticName(text: string): boolean {
  if (ENGLISH_BARE.test(text.trim())) return false;
  return ENGLISH_STRONG.test(text) || (ENGLISH_WEAK.test(text) && ENGLISH_BEAUTY_CONTEXT.test(text));
}

/** 全成分が確認済みのデータ源（Open Beauty Facts・出典ページ等）か、保存済みのお店の説明（Yahoo!）から来た候補か */
export function hasVerifiedIngredientList(p: Product): boolean {
  return isStoredSource(p) && p.ingredients.length > 0;
}
