'use client';

import React, { useSyncExternalStore } from 'react';
import { bugReportMailto, contactEmail, CONTACT_EMAIL_TEXT } from '@/lib/site';

/**
 * 連絡先のメールアドレスの表示とリンク。収集ボット対策として、サーバーで作る HTML にはアドレスも mailto: も書かず、
 * ブラウザで描画した後に組み立てる（src/lib/site.ts）。JavaScript が無いときは＠を書かない形のまま
 */

const noSubscribe = () => () => {};
/** ブラウザで描画した後なら true（サーバーでの描画と、それに合わせる最初の描画では false） */
function useInBrowser(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false
  );
}

/** 規約・ポリシーの「お問い合わせ窓口」のアドレス */
export const ContactEmail: React.FC = () => {
  const inBrowser = useInBrowser();
  if (!inBrowser) return <span>{CONTACT_EMAIL_TEXT}</span>;
  const email = contactEmail();
  return <a href={`mailto:${email}`}>{email}</a>;
};

/** 「不具合を報告」：メールを開く。組み立てる前は、利用規約のお問い合わせ窓口へのリンク */
export const BugReportLink: React.FC<{ className?: string }> = ({ className }) => {
  const inBrowser = useInBrowser();
  return (
    <a href={inBrowser ? bugReportMailto() : '/terms#contact'} className={className}>
      不具合を報告（メール）
    </a>
  );
};
