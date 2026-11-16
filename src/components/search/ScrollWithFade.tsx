'use client';

import React from 'react';

interface ScrollWithFadeProps {
  /** 枠の高さ（余白はこのコンポーネントで決める） */
  className: string;
  children: React.ReactNode;
}

/**
 * スクロールする枠。下にまだ続きがあるあいだ、下端をぼかして示す（最後まで見たら消す）。
 * ぼかしの位置（-bottom-3・-mx-3）は枠の余白 p-3 に合わせてあるので、余白はここで決める。使う側は高さだけ渡す
 */
export const ScrollWithFade: React.FC<ScrollWithFadeProps> = ({ className, children }) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const update = React.useCallback(() => {
    const el = ref.current;
    if (el) setHasMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  }, []);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    // 候補が増えたり、画面の幅が変わったりして高さが変わったときも確かめ直す
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [update]);

  return (
    <div ref={ref} onScroll={update} className={`relative p-3 overflow-y-auto ${className}`}>
      {children}
      {hasMore && (
        <div aria-hidden className="sticky -bottom-3 h-10 -mt-10 -mx-3 pointer-events-none bg-linear-to-t from-white to-transparent" />
      )}
    </div>
  );
};
