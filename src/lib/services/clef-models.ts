import 'server-only';

/**
 * Clef のモデル。Workers AI のモデル ID と、入力の model の値は組で決まる
 * （@cf/cloudflare/clef には "clef"、@cf/cloudflare/clef-flash には "clef-flash"。違う組み合わせは拒否される）
 */
export type ClefModel = 'clef' | 'clef-flash';

export function clefModelId(model: ClefModel): string {
  return `@cf/cloudflare/${model}`;
}

/** 環境変数で選んだモデル（CLEF_MODEL_GATE・CLEF_MODEL_FILTER）。未設定・不明な値なら fallback */
export function clefModelSetting(name: string, fallback: ClefModel): ClefModel {
  const value = (process.env[name] || '').trim();
  return value === 'clef' || value === 'clef-flash' ? value : fallback;
}
