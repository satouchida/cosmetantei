'use client';

import React from 'react';

interface EmptyStateProps {
  /** 空のリストの代わりに出す案内 */
  children: React.ReactNode;
}

/** リストが空のときの案内 */
export const EmptyState: React.FC<EmptyStateProps> = ({ children }) => (
  <p className="p-3 bg-surface rounded-xl border border-dashed border-sand-300 text-center text-sm text-ink-muted">
    {children}
  </p>
);
