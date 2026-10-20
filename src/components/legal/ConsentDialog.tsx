'use client';

import React from 'react';
import { ModalDialog } from '@/components/ui/ModalDialog';
import { giveConsent } from '@/lib/consent';

/**
 * 初めて開いたときの確認画面。利用規約・プライバシーポリシーと Cookie の使用に同意してから使ってもらう。
 * 閉じるボタンは置かず、Escape でも閉じない（dismissible={false}）。規約のページは新しいタブで開き、この画面は残す。
 * それでもブラウザが閉じてしまったとき（Chrome は操作の無いまま Escape を続けると閉じる）だけ、開き直す
 * （同意しないまま使えるようにしない）
 */
export const ConsentDialog: React.FC = () => {
  const [opened, reopen] = React.useReducer((n: number) => n + 1, 0);
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);
  // 開いたら見出しにフォーカスし、説明を初めから読めるようにする（showModal は最初のリンクにフォーカスするため）。
  // この effect は ModalDialog の showModal() の後に動く
  React.useEffect(() => {
    headingRef.current?.focus();
  }, [opened]);
  return (
    <ModalDialog key={opened} labelledBy="consent-title" onClose={reopen} dismissible={false} sheet>
      <div className="p-5 space-y-3 text-sm leading-relaxed">
        <h2 id="consent-title" ref={headingRef} tabIndex={-1} className="text-lg font-bold text-ink outline-none">
          ご利用の前に
        </h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            コスメ探偵は、全成分表示などの公開情報をもとにした化粧品選びの参考情報を提供するサービスです。医療上の診断ではありません。皮膚に異常があるときは皮膚科専門医にご相談ください。
          </li>
          <li>
            ボット対策と利用回数の上限の管理のため、このサイトの Cookie（<code>__Host-session</code>、有効期間24時間）を使用します。広告のための追跡には使用しません。
          </li>
          <li>
            販売ページ（Amazon・楽天市場・Yahoo!ショッピング）へのリンク（PR）を開くと、リンク先の事業者が Cookie 等で成果を計測します。
          </li>
        </ul>
        <p>
          <a href="/terms" target="_blank" rel="noopener" className="text-primary underline">
            利用規約
          </a>
          （連携する外部サービスの規約・ライセンスに従っていただくことを含みます）と
          <a href="/privacy" target="_blank" rel="noopener" className="text-primary underline">
            プライバシーポリシー（外部送信について）
          </a>
          をご確認のうえ、同意して利用を始めてください。
        </p>
        <button
          type="button"
          onClick={giveConsent}
          className="w-full min-h-12 rounded-full bg-primary hover:bg-primary-active text-on-primary font-semibold transition-colors"
        >
          同意して利用を始める
        </button>
      </div>
    </ModalDialog>
  );
};
