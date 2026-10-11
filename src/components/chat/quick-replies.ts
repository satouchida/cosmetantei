/**
 * クイック返信ボタンの動作（ブラウザ側）
 * ボタンの多くは「リストに追加する」「商品名を入力してもらう」などの画面操作で、サーバーに文言を送っても
 * 実行できない。ここで動作を決め、サーバーに送るのは商品名・調査依頼だけにする。
 * サーバー側の対応表（src/lib/services/chat-gate.ts の QUICK_REPLY_INTENTS）とあわせて管理する
 */

export type QuickReplyAction =
  /** バーコードスキャナーを開く */
  | { kind: 'scanner' }
  /** 文言の代わりに、商品名などをメッセージとして送る */
  | { kind: 'send'; text: string }
  /** 直前に分析した商品を、肌荒れ・安全リストに追加する */
  | { kind: 'add_analyzed'; list: 'bad' | 'safe' }
  /** 候補カードのボタンから選んでもらうよう案内する */
  | { kind: 'pick_from_cards' }
  /** 比較リストを空にする */
  | { kind: 'reset' }
  /** 入力欄にフォーカスし、何を入力すればよいか案内する */
  | { kind: 'prompt_input'; hint: string }
  /** そのままサーバーに送る（代わりの商品探しなど、サーバーで処理する依頼） */
  | { kind: 'server' };

const PROMPT_PRODUCT_NAME = '調べたい化粧品の名前（ブランド名＋商品名）を入力してください。';
const PROMPT_BAD_PRODUCT =
  '肌荒れしたコスメの名前を入力してください。候補が表示されたら「肌荒れした」を選ぶと、比較リストに追加されます。';
const PROMPT_SAFE_PRODUCT =
  '普段問題なく使えているコスメの名前を入力してください。候補が表示されたら「安全に使えた」を選ぶと、比較リストに追加されます。';

const ACTIONS: Readonly<Record<string, QuickReplyAction>> = {
  // 例として表示している商品は、商品名だけを送る（検索に余計な文言を含めない）
  '⚡️ メラノCCで赤みが出た': { kind: 'send', text: 'メラノCC' },
  '🔍 キュレルの泡洗顔を調べる': { kind: 'send', text: 'キュレル 泡洗顔料' },
  '🧴 キュレルの泡洗顔を調べる': { kind: 'send', text: 'キュレル 泡洗顔料' },
  '💧 トリデンのセラムを調べる': { kind: 'send', text: 'トリデン セラム' },

  '🚨 このアイテムで肌荒れした（原因を特定）': { kind: 'add_analyzed', list: 'bad' },
  '✅ 普段安全に使えている（安全リストに追加）': { kind: 'add_analyzed', list: 'safe' },

  '🚨 この中のアイテムで肌荒れした': { kind: 'pick_from_cards' },
  '✅ この中のアイテムは安全に使えた': { kind: 'pick_from_cards' },

  '🔄 リセットする': { kind: 'reset' },

  '🧴 肌荒れしたコスメを入力する': { kind: 'prompt_input', hint: PROMPT_BAD_PRODUCT },
  '🔍 肌荒れしたコスメを検索': { kind: 'prompt_input', hint: PROMPT_BAD_PRODUCT },
  '✅ 普段使えているコスメを入力する': { kind: 'prompt_input', hint: PROMPT_SAFE_PRODUCT },
  '🔍 商品名で検索する': { kind: 'prompt_input', hint: PROMPT_PRODUCT_NAME },
  '🔍 具体的な商品名で再検索': { kind: 'prompt_input', hint: PROMPT_PRODUCT_NAME },
  '🔍 別のキーワードで調べる': { kind: 'prompt_input', hint: PROMPT_PRODUCT_NAME },
  '🔍 別のコスメを調べる': { kind: 'prompt_input', hint: PROMPT_PRODUCT_NAME },
  '🔍 他のコスメも調べる': { kind: 'prompt_input', hint: PROMPT_PRODUCT_NAME },
  '🔍 別のコスメを追加する': { kind: 'prompt_input', hint: PROMPT_PRODUCT_NAME },
};

/** ブラウザ側で処理するボタンの文言（サーバーには送られない） */
export const CLIENT_HANDLED_LABELS: readonly string[] = Object.keys(ACTIONS);

export function getQuickReplyAction(label: string): QuickReplyAction {
  if (label.includes('バーコード')) return { kind: 'scanner' };
  return ACTIONS[label] ?? { kind: 'server' };
}

/** 候補カードから選んでもらう案内文 */
export const PICK_FROM_CARDS_HINT =
  '上の候補カードにある「肌荒れした」「安全に使えた」ボタンから、該当するコスメを選んでください。選んだコスメは比較リストに追加されます。';
