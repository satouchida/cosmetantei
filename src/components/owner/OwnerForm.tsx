'use client';

import React, { useState } from 'react';

/** 運営者の鍵を送って、このブラウザに利用枠の Cookie を付ける・消す（src/app/api/owner/route.ts） */
export const OwnerForm: React.FC = () => {
  const [key, setKey] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (method: 'POST' | 'DELETE') => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/owner', {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(method === 'POST' && { body: JSON.stringify({ key }) }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && data?.ok) {
        setKey('');
        setMessage({ ok: true, text: method === 'POST' ? 'このブラウザに利用枠を付けました（30日間）。' : 'このブラウザの利用枠を外しました。' });
      } else {
        setMessage({ ok: false, text: data?.error ?? `失敗しました（${res.status}）。` });
      }
    } catch {
      setMessage({ ok: false, text: '送れませんでした。通信を確かめて、もう一度お試しください。' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="mt-6 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void send('POST');
      }}
    >
      <label className="block text-sm font-semibold" htmlFor="owner-key">
        運営者の鍵
      </label>
      <input
        id="owner-key"
        type="password"
        autoComplete="off"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        className="w-full min-h-11 rounded-lg border border-sand-200 bg-white px-3 text-base"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || !key.trim()}
          className="min-h-11 px-4 rounded-lg bg-primary text-white font-semibold disabled:opacity-50"
        >
          利用枠を付ける
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void send('DELETE')}
          className="min-h-11 px-4 rounded-lg border border-sand-200 bg-white font-semibold disabled:opacity-50"
        >
          外す
        </button>
      </div>
      {message && (
        <p role="status" className={message.ok ? 'text-sm text-green-800' : 'text-sm text-red-700'}>
          {message.text}
        </p>
      )}
    </form>
  );
};
