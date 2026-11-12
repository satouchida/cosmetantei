import { ChatMessage, Product } from '@/lib/types';
import { DIFFERENTIAL_LABEL } from '../routine/routine-labels';
import { getQuickReplyAction, PICK_FROM_CARDS_HINT } from './quick-replies';
import { ONCE_PER_MESSAGE_LABELS, WAIT_MESSAGE } from './chat-helpers';
import type { AddResult, ShowToast } from './useRoutineLists';

/** クイック返信ボタンが呼ぶ処理（useChatRequests が渡す） */
export interface QuickReplyHandlers {
  openScanner: () => void;
  openLabelInput: () => void;
  /** サーバーの応答を待っているか */
  isBusy: () => boolean;
  showToast: ShowToast;
  /** 一度押した有料の調べもののボタン（吹き出しの id と文言） */
  isUsed: (usedKey: string) => boolean;
  markUsed: (usedKey: string) => void;
  /** 失敗の吹き出しの「もう一度送る」で送る頼みごとを取り出す（同じ吹き出しからは1回だけなので、取り出したら消す） */
  takeRetry: (messageId: string) => (() => Promise<unknown>) | undefined;
  sendMessage: (text: string) => void;
  addToBad: (product: Product) => AddResult;
  addToUsable: (product: Product) => AddResult;
  priceLookup: (label: string, product: Product) => void;
  researchProduct: (label: string, product: Product) => void;
  /** 肌荒れしたコスメのリストを空にする */
  clearBad: () => void;
  /** 利用者の吹き出しと、ブラウザで作った返答の吹き出しを足す（サーバーには送らない） */
  appendLocalExchange: (label: string, reply: string, quickReplies?: string[]) => void;
  focusInput: () => void;
}

/** クイック返信ボタンの処理（画面操作はブラウザ側で行い、調査依頼だけをサーバーに送る） */
export function dispatchQuickReply(label: string, sourceMessage: ChatMessage, h: QuickReplyHandlers): void {
  const action = getQuickReplyAction(label);
  if (action.kind === 'scanner') {
    h.openScanner();
    return;
  }
  if (action.kind === 'label_input') {
    h.openLabelInput();
    return;
  }
  // 応答待ちの間は、メッセージの順序が入れ替わらないよう他のボタンを受け付けない（押されたことは伝える）
  if (h.isBusy()) {
    h.showToast(WAIT_MESSAGE, 'error');
    return;
  }
  // 有料の調べもの・もう一度送るボタンは、同じ吹き出しでは1回だけ（前の吹き出しのボタンで何度も調べない）。
  // 使った印は、実際に頼んだときだけ付ける
  const usedKey = `${sourceMessage.id}|${label}`;
  if (ONCE_PER_MESSAGE_LABELS.has(label) && h.isUsed(usedKey)) {
    h.showToast('このボタンはもう使いました。結果は下の吹き出しにあります。', 'error');
    return;
  }
  const markUsed = () => h.markUsed(usedKey);
  switch (action.kind) {
    case 'retry': {
      // 同じ失敗の吹き出しからは1回だけ（また失敗したら、新しい吹き出しにボタンが付く）
      const retry = h.takeRetry(sourceMessage.id);
      if (!retry) {
        h.appendLocalExchange(label, 'もう一度送れる内容が見つかりませんでした。入力し直してください。');
        return;
      }
      markUsed();
      void retry();
      return;
    }
    case 'send':
      h.sendMessage(action.text);
      return;
    case 'add_analyzed': {
      const product = sourceMessage.singleAnalysis?.product;
      if (!product) {
        h.appendLocalExchange(label, PICK_FROM_CARDS_HINT);
        return;
      }
      // もう一方のリストにあるときは、ダイアログで移すか削除するかを聞く（返答は出さない）。上限のときは案内だけ
      if (action.list === 'bad') {
        const result = h.addToBad(product);
        if (result === 'conflict' || result === 'full') return;
        h.appendLocalExchange(
          label,
          result === 'added'
            ? `「${product.name}」を【肌荒れしたコスメ】に追加しました。問題なく使えるコスメも追加して「${DIFFERENTIAL_LABEL}」を押すと、肌荒れの原因になった可能性のある成分の候補を絞り込めます。`
            : `「${product.name}」はすでに【肌荒れしたコスメ】に登録されています。問題なく使えるコスメも追加して「${DIFFERENTIAL_LABEL}」を押してください。`,
          ['✅ 使えるコスメを入力する']
        );
      } else {
        const result = h.addToUsable(product);
        if (result === 'conflict' || result === 'full') return;
        h.appendLocalExchange(
          label,
          result === 'added'
            ? `「${product.name}」を【使えるコスメ】に追加しました。肌荒れしたコスメも追加して「${DIFFERENTIAL_LABEL}」を押すと、原因になりうる成分の候補を絞り込めます。`
            : `「${product.name}」はすでに【使えるコスメ】に登録されています。肌荒れしたコスメを追加して「${DIFFERENTIAL_LABEL}」を押してください。`,
          ['🧴 肌荒れしたコスメを入力する']
        );
      }
      return;
    }
    case 'price_analyzed': {
      const product = sourceMessage.singleAnalysis?.product;
      if (product) {
        markUsed();
        h.priceLookup(label, product);
      } else h.appendLocalExchange(label, PICK_FROM_CARDS_HINT);
      return;
    }
    case 'research_analyzed': {
      const product = sourceMessage.singleAnalysis?.product;
      if (product) {
        markUsed();
        h.researchProduct(label, product);
      } else h.appendLocalExchange(label, PICK_FROM_CARDS_HINT);
      return;
    }
    case 'pick_from_cards':
      h.appendLocalExchange(label, PICK_FROM_CARDS_HINT);
      return;
    case 'reset':
      // 保存している使えるコスメは消さない（消すときはサイドバーの「使えるコスメのリストをクリア」）
      h.clearBad();
      h.appendLocalExchange(label, '肌荒れしたコスメのリストを空にしました（使えるコスメはそのままです）。', [
        '🧴 肌荒れしたコスメを入力する',
      ]);
      return;
    case 'prompt_input':
      h.appendLocalExchange(label, action.hint);
      h.focusInput();
      return;
    case 'server':
      h.sendMessage(label);
      return;
    default: {
      // 新しい種類のボタンを足したら、ここで扱うまでコンパイルが通らない
      const unhandled: never = action;
      return unhandled;
    }
  }
}
