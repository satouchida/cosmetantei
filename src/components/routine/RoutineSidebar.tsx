'use client';

import React from 'react';
import { Product, UserRoutineState } from '@/lib/types';
import { AlertTriangle, ShieldCheck, Trash2, Sparkles, Plus, RefreshCw, Barcode } from 'lucide-react';

interface RoutineSidebarProps {
  routine: UserRoutineState;
  onRemoveBad: (productId: string) => void;
  onRemoveSafe: (productId: string) => void;
  onRunDifferential: () => void;
  onOpenScanner: () => void;
  onLoadPreset: (presetType: 'sample_irritation' | 'clear') => void;
}

export const RoutineSidebar: React.FC<RoutineSidebarProps> = ({
  routine,
  onRemoveBad,
  onRemoveSafe,
  onRunDifferential,
  onOpenScanner,
  onLoadPreset,
}) => {
  const { badProducts, safeProducts } = routine;

  return (
    <aside className="w-full lg:w-80 bg-sand-50/70 border-b lg:border-b-0 lg:border-l border-sand-200 p-4 sm:p-5 flex flex-col justify-between overflow-y-auto max-h-[85vh] lg:max-h-none">
      <div className="space-y-5">
        {/* Header */}
        <div>
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-gray-900 text-sm flex items-center gap-1.5">
              <span>🧴 マイルーティン管理</span>
            </h3>
            <button
              type="button"
              onClick={() => onLoadPreset('clear')}
              className="text-[11px] text-gray-400 hover:text-gray-600 flex items-center gap-0.5"
            >
              <RefreshCw className="w-3 h-3" />
              <span>クリア</span>
            </button>
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">
            コスメを登録して刺激成分を比較・あぶり出し
          </p>
        </div>

        {/* 🚨 Bad Products Section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-rose-700">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
              <span>肌荒れしたコスメ ({badProducts.length})</span>
            </div>
          </div>

          {badProducts.length === 0 ? (
            <div className="p-3 bg-white rounded-xl border border-dashed border-sand-300 text-center text-xs text-gray-400">
              チャットでコスメを検索、またはバーコードをスキャンして追加
            </div>
          ) : (
            <div className="space-y-1.5">
              {badProducts.map((p) => (
                <div
                  key={p.id}
                  className="bg-white p-2.5 rounded-xl border border-rose-200/80 shadow-2xs flex items-center justify-between gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-bold text-rose-600 truncate">{p.brand}</div>
                    <div className="text-xs font-semibold text-gray-800 truncate">{p.name}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveBad(p.id)}
                    className="text-gray-300 hover:text-rose-600 p-1 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ✅ Safe Products Section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>安全に使えているコスメ ({safeProducts.length})</span>
            </div>
          </div>

          {safeProducts.length === 0 ? (
            <div className="p-3 bg-white rounded-xl border border-dashed border-sand-300 text-center text-xs text-gray-400">
              普段問題なく使えているコスメを追加すると、除外照合で原因特定が高精度になります
            </div>
          ) : (
            <div className="space-y-1.5">
              {safeProducts.map((p) => (
                <div
                  key={p.id}
                  className="bg-white p-2.5 rounded-xl border border-emerald-200/80 shadow-2xs flex items-center justify-between gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-bold text-emerald-600 truncate">{p.brand}</div>
                    <div className="text-xs font-semibold text-gray-800 truncate">{p.name}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveSafe(p.id)}
                    className="text-gray-300 hover:text-rose-600 p-1 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Differential Action Trigger */}
        <div className="pt-2">
          <button
            type="button"
            onClick={onRunDifferential}
            disabled={badProducts.length === 0}
            className="w-full py-2.5 px-3 bg-gradient-to-r from-rose-500 to-amber-500 hover:from-rose-600 hover:to-amber-600 disabled:opacity-40 text-white rounded-xl text-xs font-bold shadow-md flex items-center justify-center gap-2 transition-all"
          >
            <Sparkles className="w-4 h-4" />
            <span>⚡️ 原因成分をあぶり出す (差分分析)</span>
          </button>
        </div>
      </div>

      {/* Bottom Presets */}
      <div className="mt-6 pt-4 border-t border-sand-200 space-y-2">
        <button
          type="button"
          onClick={onOpenScanner}
          className="w-full py-2 px-3 bg-white hover:bg-sage-50 text-sage-800 border border-sand-300 rounded-xl text-xs font-medium flex items-center justify-center gap-2 transition-colors"
        >
          <Barcode className="w-4 h-4 text-sage-600" />
          <span>JANバーコードをスキャン</span>
        </button>

        <button
          type="button"
          onClick={() => onLoadPreset('sample_irritation')}
          className="w-full py-1.5 px-2 bg-sand-100/70 hover:bg-sand-200/70 text-gray-600 rounded-lg text-[11px] font-medium transition-colors text-center"
        >
          🧪 テスト用比較データを自動セット
        </button>
      </div>
    </aside>
  );
};
