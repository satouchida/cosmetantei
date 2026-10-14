import { KnownIngredient, PairFinding, Product, ReferenceLink } from '../types';
import { normalizeIngredientName } from '../utils/ingredient-name';

/**
 * 製品をまたぐ組み合わせの注意（docs/plans/japan-ingredient-data.md の Step 5）。
 * 肌荒れした製品を一緒に使っていた場合（trouble）と、今使っている製品（current）に、
 * 成分の重なりで刺激やアレルギーが起こりやすくなる組み合わせを知らせる。
 * どのルールも出典の書き方をこえない（医薬品の注意は医薬品の注意として書く）
 */

/** trouble: 肌荒れした製品（差分分析）。current: 今使っている製品（組み合わせチェック） */
export type PairContext = 'trouble' | 'current';

const SOURCES = {
  retinA: {
    title: 'RETIN-A (tretinoin) cream and gel, prescribing information (DailyMed): Precautions, Drug Interactions',
    url: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=9556d73d-c573-4e0a-9feb-764ce2d1107b',
  },
  acneMonograph: {
    title: '21 CFR 333.350: Labeling of topical acne drug products (warnings)',
    url: 'https://www.law.cornell.edu/cfr/text/21/333.350',
  },
  fdaAha: {
    title: 'U.S. FDA: Alpha Hydroxy Acids (sun sensitivity, 2005 labeling guidance)',
    url: 'https://www.fda.gov/cosmetics/cosmetic-ingredients/alpha-hydroxy-acids',
  },
  sccsFragranceExposure: {
    title: 'European Commission, SCCS opinion on fragrance allergens (2012), summary: How is the general public exposed to fragrance allergens?',
    url: 'https://ec.europa.eu/health/scientific_committees/opinions_layman/perfume-allergies/en/l-3/5-exposure-public.htm',
  },
} satisfies Record<string, ReferenceLink>;

/** 角質に働く成分の種類 */
type ExfoliantKind = 'retinoid' | 'salicylic' | 'aha' | 'sulfur_resorcinol';

const EXFOLIANT_LABEL: Record<ExfoliantKind, string> = {
  retinoid: 'レチノール類',
  salicylic: 'サリチル酸',
  aha: 'AHA',
  sulfur_resorcinol: 'イオウ・レゾルシン',
};

const SULFUR_RESORCINOL = new Set(['イオウ', '硫黄', 'sulfur', 'sulphur', 'レゾルシン', 'resorcinol'].map(normalizeIngredientName));
/** レチノールとレチナールだけ（パルミチン酸レチノールなどのエステルは、少量のビタミンAとして多くの製品に入るため含めない） */
const RETINOID_NAME = /^(レチノール|レチナール|retinol|retinal)$/;
/** FDA のページが対象にする AHA（グリコール酸・マンデル酸と塩）。PHA は出典が無いため含めない */
const AHA_NAME = /^(グリコール酸|マンデル酸|glycolicacid|mandelicacid)/;

function exfoliantKind(raw: string, resolved: KnownIngredient): ExfoliantKind | undefined {
  const norm = normalizeIngredientName(raw);
  if (resolved.id === 'retinol' && RETINOID_NAME.test(norm)) return 'retinoid';
  if (resolved.id === 'salicylic_acid') return 'salicylic';
  if (resolved.id === 'glycolic_acid' || AHA_NAME.test(norm)) return 'aha';
  if (SULFUR_RESORCINOL.has(norm)) return 'sulfur_resorcinol';
  return undefined;
}

function isFragrance(resolved: KnownIngredient): boolean {
  return resolved.category === 'fragrance' || resolved.category === 'essential_oil';
}

interface ProductProfile {
  name: string;
  exfoliants: Map<ExfoliantKind, string[]>;
  fragrances: string[];
}

/** resolve は成分名から成分の解説（成分DB、無ければルール）を返す（ingredient-analyzer から渡す） */
export function findPairFindings(
  products: Product[],
  ingredientsOf: (p: Product) => string[],
  resolve: (raw: string) => KnownIngredient,
  context: PairContext = 'trouble'
): PairFinding[] {
  const trouble = context === 'trouble';
  // 同じ製品が2回入っていても1つと数える
  const unique = [...new Map(products.map((p) => [p.id, p])).values()];
  const profiles: ProductProfile[] = unique.map((p) => {
    const exfoliants = new Map<ExfoliantKind, string[]>();
    const fragrances: string[] = [];
    for (const raw of ingredientsOf(p)) {
      const resolved = resolve(raw);
      const kind = exfoliantKind(raw, resolved);
      if (kind) exfoliants.set(kind, [...(exfoliants.get(kind) ?? []), raw]);
      if (isFragrance(resolved) && !fragrances.includes(raw)) fragrances.push(raw);
    }
    return { name: p.name.trim() || '名前のない製品', exfoliants, fragrances };
  });

  const findings: PairFinding[] = [];

  // 1. レチノール類と、サリチル酸・イオウ・レゾルシンを、別々の製品で
  const withRetinoid = profiles.filter((p) => p.exfoliants.has('retinoid'));
  const withSalicylicGroup = profiles.filter((p) => p.exfoliants.has('salicylic') || p.exfoliants.has('sulfur_resorcinol'));
  const retinoidPair =
    withRetinoid.length > 0 && withSalicylicGroup.some((s) => withRetinoid.some((r) => r !== s));
  if (retinoidPair) {
    const involved = profiles.filter((p) => withRetinoid.includes(p) || withSalicylicGroup.includes(p));
    findings.push({
      id: 'retinoid_with_salicylic',
      titleJa: 'レチノール類とサリチル酸などの重ね使い',
      textJa:
        (trouble
          ? 'レチノール類を含む製品と、サリチル酸・イオウ・レゾルシンを含む製品を一緒に使っていた場合、刺激や乾燥が出ることがあります。'
          : 'レチノール類を含む製品と、サリチル酸・イオウ・レゾルシンを含む製品を一緒に使うと、刺激や乾燥が出ることがあります。') +
        '米国の医薬品（トレチノイン）の添付文書には、サリチル酸・イオウ・レゾルシンを含む製品との併用に特に注意するよう書かれています。化粧品のレチノールは医薬品のトレチノインとは別の成分で、この注意がそのまま当てはまるとは限りません。' +
        (trouble
          ? '肌荒れが落ち着くまでは、どちらか一方にすると原因を確かめやすくなります。'
          : '赤みやヒリつきが出たら、どちらか一方にして様子をみてください。'),
      products: involved.map((p) => p.name),
      ingredients: uniqueIngredients(involved, ['retinoid', 'salicylic', 'sulfur_resorcinol']),
      sources: [SOURCES.retinA],
    });
  }

  // 2. 角質に働く成分が2つ以上の製品に。1 に当たるときは、1 に入らない製品か AHA があるときだけ
  //    （AHA の紫外線の注意を落とさない）
  const withExfoliant = profiles.filter((p) => p.exfoliants.size > 0);
  const inRetinoidPair = (p: ProductProfile) => retinoidPair && (withRetinoid.includes(p) || withSalicylicGroup.includes(p));
  const kinds = new Set(withExfoliant.flatMap((p) => [...p.exfoliants.keys()]));
  const hasAha = kinds.has('aha');
  const addsSomething = !retinoidPair || hasAha || withExfoliant.some((p) => !inRetinoidPair(p));
  if (withExfoliant.length >= 2 && addsSomething) {
    // ニキビ用医薬品の規則は、サリチル酸・イオウ・レゾルシンがあるときだけ引く
    const hasAcneKind = kinds.has('salicylic') || kinds.has('sulfur_resorcinol');
    findings.push({
      id: 'exfoliant_overlap',
      titleJa: '角質に働く成分の重ね使い',
      textJa:
        `角質に働く成分（${[...kinds].map((k) => EXFOLIANT_LABEL[k]).join('・')}）が${withExfoliant.length}つの製品に入っています。一緒に使うと刺激や乾燥が出ることがあります。` +
        (hasAcneKind
          ? '米国では、サリチル酸などを含む市販のニキビ用医薬品に「ほかのニキビ用の外用剤と同時に使うと、刺激や乾燥が起こりやすい」と表示するよう定められています（化粧品への規定ではありません）。'
          : '') +
        (hasAha ? 'AHAは紫外線に対する肌の感受性を高めるため、使用中と使用後1週間は日焼け止めなどで紫外線を避けるよう、米国FDAが勧めています。' : ''),
      products: withExfoliant.map((p) => p.name),
      ingredients: uniqueIngredients(withExfoliant, [...kinds]),
      sources: [...(hasAcneKind ? [SOURCES.acneMonograph] : []), ...(hasAha ? [SOURCES.fdaAha] : [])],
    });
  }

  // 3. 香料成分が2つ以上の製品に
  const withFragrance = profiles.filter((p) => p.fragrances.length > 0);
  if (withFragrance.length >= 2) {
    findings.push({
      id: 'fragrance_overlap',
      titleJa: '香料成分の重なり',
      textJa: `香料成分が${withFragrance.length}つの製品に入っています。香料によるかぶれの起こりやすさは、製品ごとではなく、肌の同じ場所に触れる量の合計に左右されるとされています（欧州委員会の科学委員会）。香料でかぶれたことがある場合は、${trouble ? '無香料の製品に置き換えると比べやすくなります' : '香料を含む製品を無香料のものに置き換えると、肌に触れる香料を減らせます'}。`,
      products: withFragrance.map((p) => p.name),
      ingredients: [...new Set(withFragrance.flatMap((p) => p.fragrances))],
      sources: [SOURCES.sccsFragranceExposure],
    });
  }

  return findings;
}

function uniqueIngredients(profiles: ProductProfile[], kinds: ExfoliantKind[]): string[] {
  return [...new Set(profiles.flatMap((p) => kinds.flatMap((k) => p.exfoliants.get(k) ?? [])))];
}
