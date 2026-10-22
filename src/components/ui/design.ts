/**
 * Stitch「cosmetantei」デザインシステム（Clinical Mint & Botanical Care / Material 3）の部品のクラス。
 * 色の値は src/app/globals.css の @theme にある。カード・ボタン・注意書き・バッジはここの組み合わせだけを使う
 * - タップできるものは高さ 48px 以上、文字は 12px 以上
 * - 赤（rose）は刺激・肌荒れの警告だけに使う。緑（emerald）は安全、水色（sky）は「今使っている」
 */
import type { IngredientRiskLevel } from '@/lib/types';

/** チャットの中の結果カード（Level 1：白い面 + 細い境界線） */
export const card = 'bg-white rounded-2xl border border-sand-200 shadow-xs';

/** カード内の小さなカード（商品・成分の 1 件） */
export const innerCard = 'bg-white rounded-xl border border-sand-200';

/** 医薬部外品の「有効成分:」の行。承認の区分を示すだけなので、安全の緑ではなく中立の色にする */
export const activesLine = 'text-xs text-ink bg-surface-container-low px-2 py-1 rounded-lg';

// 余白などはクラスを後から足して上書きしない（Tailwind はクラスの書き順でなく CSS の順で決まる）。違う大きさは別の定数にする
// 狭い画面で折り返すとき：語の途中では切らず（break-keep）、空白・句読点・ラベルに入れた <wbr /> の位置で、
// 行の長さをそろえて折り返す（「成分を<wbr />詳しく<wbr />チェック」→「成分を詳しく／チェック」）。
// <wbr /> の無い長いラベルや、それでも入らない幅のときは、はみ出す位置で文字の間で切れる（body の overflow-wrap: anywhere）。
// 折り返しうるラベル（2 列のボタン・カードの中のボタン）には <wbr /> を入れる
const buttonBase =
  'min-h-12 inline-flex items-center justify-center gap-2 text-sm font-semibold break-keep text-balance transition-colors disabled:cursor-not-allowed';
const primaryLook =
  'rounded-2xl bg-primary text-on-primary shadow-xs hover:bg-primary-active disabled:bg-gray-100 disabled:text-gray-500 disabled:shadow-none';
const secondaryLook =
  'rounded-2xl bg-white text-primary border-[1.5px] border-primary hover:bg-tint-safe disabled:border-transparent disabled:bg-gray-100 disabled:text-gray-500';

/** 主な操作：塗りつぶしの primary */
export const buttonPrimary = `${buttonBase} px-5 ${primaryLook}`;
/** 主な操作（2 つ並べるなど幅の狭いところ） */
export const buttonPrimaryCompact = `${buttonBase} px-3 ${primaryLook}`;

/** 補助の操作：primary の枠線 */
export const buttonSecondary = `${buttonBase} px-5 ${secondaryLook}`;
/** 補助の操作（幅の狭いところ） */
export const buttonSecondaryCompact = `${buttonBase} px-3 ${secondaryLook}`;

/** 目立たせない操作：薄い面 */
export const buttonTonal = `${buttonBase} px-4 rounded-xl bg-surface-container-low text-ink hover:bg-surface-container disabled:text-gray-500`;

/**
 * 応答を待っている間の、押せる（押すと案内が出る）ボタンの見た目。aria-disabled と一緒に使う。
 * 文字は薄くしない（押せるボタンなので、文字のコントラストを保つ。gray-700 / gray-100 は 9:1 以上）
 */
export const busyLook =
  'aria-disabled:bg-gray-100 aria-disabled:text-gray-700 aria-disabled:border-transparent aria-disabled:shadow-none aria-disabled:cursor-wait';

/** アイコンだけのボタン（48px の円） */
export const iconButton =
  'w-12 h-12 shrink-0 inline-flex items-center justify-center rounded-full text-ink hover:bg-surface-container transition-colors';

/** 文中のリンク */
export const textLink = 'underline underline-offset-2 text-sage-700 hover:text-sage-900';

export type Tone = 'safe' | 'warning' | 'caution' | 'notice' | 'current' | 'neutral' | 'brand';

const panelTones: Record<Tone, string> = {
  safe: 'bg-tint-safe border-emerald-200 border-l-emerald-600 text-emerald-950',
  warning: 'bg-tint-warning border-rose-200 border-l-rose-600 text-rose-950',
  caution: 'bg-amber-50 border-amber-200 border-l-amber-600 text-amber-950',
  notice: 'bg-orange-50 border-orange-200 border-l-orange-600 text-orange-950',
  current: 'bg-sky-50 border-sky-200 border-l-sky-600 text-sky-950',
  neutral: 'bg-surface-container-low border-sand-200 border-l-sand-400 text-ink',
  brand: 'bg-brand-badge border-amber-200 border-l-amber-600 text-on-brand-badge',
};

/** 注意書き・結果の囲み（左に 3px の色の線）。small は補足の注意書き（12px）、roomy はカードを並べる囲み */
export function panel(tone: Tone, size: 'regular' | 'small' | 'roomy' = 'regular'): string {
  const sizing = size === 'small' ? 'p-3 text-xs' : size === 'roomy' ? 'p-4 text-sm' : 'p-3 text-sm';
  return `rounded-xl border border-l-[3px] leading-relaxed ${sizing} ${panelTones[tone]}`;
}

const badgeTones: Record<Tone, string> = {
  safe: 'bg-tint-safe text-emerald-800 border-emerald-200',
  warning: 'bg-tint-warning text-rose-800 border-rose-200',
  caution: 'bg-amber-50 text-amber-900 border-amber-200',
  notice: 'bg-orange-50 text-orange-900 border-orange-200',
  current: 'bg-sky-50 text-sky-800 border-sky-200',
  neutral: 'bg-surface-container-low text-ink-muted border-sand-200',
  brand: 'bg-brand-badge text-on-brand-badge border-amber-200',
};

// 1行に収まる幅があれば1行。カードより広いときだけ中で折り返す（nowrap だと狭い画面ではみ出す）
const badgeBase = 'inline-flex items-center gap-1 shrink-0 max-w-full rounded-full border font-semibold';

/** 小さなラベル（丸いバッジ）。large は結果の判定など目立たせるもの */
export function badge(tone: Tone, size: 'regular' | 'large' = 'regular'): string {
  const sizing = size === 'large' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs';
  return `${badgeBase} ${sizing} ${badgeTones[tone]}`;
}

/**
 * 成分の刺激の段階（色だけでなく文字でも示す）。mark: 成分のボタンに出す1文字（一覧の上に凡例を出す）
 */
export const RISK_SCALE: Record<IngredientRiskLevel, { label: string; mark: string; badge: string; pill: string }> = {
  high_irritant: {
    label: '高刺激・アレルゲン',
    mark: '高',
    badge: 'bg-tint-warning text-rose-800 border-rose-300',
    pill: 'bg-tint-warning text-rose-900 border-rose-300 hover:bg-rose-100',
  },
  moderate_irritant: {
    label: '乾燥・刺激リスク',
    mark: '刺',
    badge: 'bg-orange-50 text-orange-900 border-orange-300',
    pill: 'bg-orange-50 text-orange-900 border-orange-300 hover:bg-orange-100',
  },
  active_caution: {
    label: '高濃度アクティブ',
    mark: '活',
    badge: 'bg-violet-50 text-violet-800 border-violet-300',
    pill: 'bg-violet-50 text-violet-900 border-violet-300 hover:bg-violet-100',
  },
  low_caution: {
    label: '軽度の注意',
    mark: '注',
    badge: 'bg-amber-50 text-amber-900 border-amber-300',
    pill: 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100',
  },
  unknown: {
    label: '未評価',
    mark: '？',
    badge: 'bg-white text-ink-muted border-sand-300 border-dashed',
    pill: 'bg-white text-ink-muted border-sand-300 border-dashed hover:bg-surface-container-low',
  },
  safe: {
    label: '刺激の報告が少ない',
    mark: '',
    badge: 'bg-tint-safe text-emerald-800 border-emerald-300',
    pill: 'bg-white text-ink border-sand-200 hover:bg-surface-container-low',
  },
};

/** 段階の分からない値（AI の返した値など）は「未評価」として扱う */
export function riskOf(level: IngredientRiskLevel | undefined) {
  return (level && RISK_SCALE[level]) || RISK_SCALE.unknown;
}

/** 成分の刺激の段階のバッジ */
export function riskBadge(level: IngredientRiskLevel | undefined): string {
  return `${badgeBase} px-2 py-0.5 text-xs ${riskOf(level).badge}`;
}

/** 「肌荒れした・普段使えている・今使っている」に登録するボタン */
export const routineAction = {
  bad: 'bg-tint-warning hover:bg-rose-100 text-rose-800 border-rose-200',
  safe: 'bg-tint-safe hover:bg-emerald-100 text-emerald-800 border-emerald-200',
  current: 'bg-sky-50 hover:bg-sky-100 text-sky-800 border-sky-200',
} as const;

/**
 * カードの下の操作の枠（区切り線の下）。登録ボタンの並べ方（routineActionGrid）はこの枠の幅で決まるので、
 * @container を付けてある。上の余白は使う側で足す
 */
export const cardActionsBox = 'pt-3 border-t border-sand-200 space-y-2 @container';

/**
 * 登録ボタン 3 つを並べる枠。カードの幅（画面の幅ではない）で決める：16rem 以上なら横に 3 つ、
 * それより狭いカード（320px の画面のチャットのカードなど）では縦に積む。cardActionsBox の中に置くこと
 * （@container の枠が無いと、いつも縦に積む）
 */
export const routineActionGrid = 'grid grid-cols-1 @min-[16rem]:grid-cols-3 gap-2';

/**
 * 登録ボタン（routineActionGrid の中）。横に 3 つのときはアイコンの下にラベル、縦に積むときはアイコンの横にラベル。
 * ラベルは語の途中では切らず（break-keep）、ラベルに入れた <wbr /> の位置で折り返す（「肌荒れ<wbr />した」→「肌荒れ／した」）。
 * それでも入らない幅のときだけ、はみ出す位置で切る（overflow-wrap: anywhere）
 */
export const routineActionCompact =
  'flex flex-row @min-[16rem]:flex-col items-center justify-center gap-1.5 @min-[16rem]:gap-0.5 min-h-12 py-1.5 px-1 text-center leading-tight break-keep text-balance [overflow-wrap:anywhere] border rounded-xl text-xs font-semibold transition-colors';

/** 登録ボタンを横長で並べるとき */
export const routineActionWide =
  'min-h-12 inline-flex items-center justify-center gap-1.5 px-3 border rounded-xl text-sm font-semibold transition-colors';
