import type { Metadata } from 'next';
import { OwnerForm } from '@/components/owner/OwnerForm';

// 運営者の利用枠（src/lib/server/owner.ts）。運営者だけが使うページなので、検索に出さない
export const metadata: Metadata = {
  title: '運営者の利用枠',
  robots: { index: false, follow: false },
};

export default function OwnerPage() {
  return (
    <div className="min-h-dvh bg-surface text-ink">
      <main className="max-w-[480px] mx-auto px-4 py-10">
        <h1 className="text-xl font-bold">運営者の利用枠</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
          このブラウザに、1日の利用枠を広げる Cookie を付けます（30日間）。運営者の鍵を知っている人だけが使えます。
        </p>
        <OwnerForm />
      </main>
    </div>
  );
}
