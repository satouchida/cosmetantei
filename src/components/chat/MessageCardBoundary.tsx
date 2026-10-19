'use client';

import React from 'react';
import { panel } from '../ui/design';

/**
 * 1つの吹き出しの結果のカードで描けない応答（形の違うデータ）が来ても、ページ全体を止めない。
 * その吹き出しにだけ案内を出し、会話と比較リストはそのまま残す
 */
export class MessageCardBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.error('Result card failed to render:', error instanceof Error ? error.message : error);
  }

  render() {
    if (this.state.failed) {
      return (
        <p role="alert" className={`mt-3 ${panel('caution', 'small')}`}>
          結果を表示できませんでした。もう一度お試しください。
        </p>
      );
    }
    return this.props.children;
  }
}
