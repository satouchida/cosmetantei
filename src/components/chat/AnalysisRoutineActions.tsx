'use client';

import React from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { routineAction, routineActionWide } from '../ui/design';

interface AnalysisRoutineActionsProps {
  /** 無いときはボタンを出さない */
  onAddToBadRoutine?: () => void;
  onAddToUsableRoutine?: () => void;
}

/** Routine Quick Actions：分析した製品を2つのリストに登録するボタン */
export const AnalysisRoutineActions: React.FC<AnalysisRoutineActionsProps> = ({ onAddToBadRoutine, onAddToUsableRoutine }) => (
  <div className="pt-3 border-t border-sand-200 grid grid-cols-1 sm:grid-cols-2 gap-2">
    {onAddToBadRoutine && (
      <button type="button" onClick={onAddToBadRoutine} className={`${routineActionWide} ${routineAction.bad}`}>
        <AlertTriangle className="w-4 h-4" aria-hidden />
        <span>「肌荒れしたコスメ」に登録</span>
      </button>
    )}
    {onAddToUsableRoutine && (
      <button type="button" onClick={onAddToUsableRoutine} className={`${routineActionWide} ${routineAction.safe}`}>
        <ShieldCheck className="w-4 h-4" aria-hidden />
        <span>「使えるコスメ」に登録</span>
      </button>
    )}
  </div>
);
