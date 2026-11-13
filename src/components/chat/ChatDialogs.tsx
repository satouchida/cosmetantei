'use client';

import React, { type RefObject } from 'react';
import { BarcodeScannerModal } from '../scanner/BarcodeScannerModal';
import { LabelInputModal, LabelInput } from '../label/LabelInputModal';
import { BAD_SECTION_ID, USABLE_SECTION_ID } from '../routine/RoutineSidebar';
import { RoutineExportDialog } from '../routine/RoutineExportDialog';
import { RoutineImportDialog } from '../routine/RoutineImportDialog';
import { ChoiceDialog } from '../routine/ChoiceDialog';
import { ExportReminderDialog } from '../routine/ExportReminderDialog';
import { isPersistable } from '@/lib/usable-products';
import { turnOffExportReminder } from '@/lib/client/export-reminder';
import { ROUTINE_QR_READER_ID } from './chat-helpers';
import type { useRoutineLists } from './useRoutineLists';
import type { useRoutineTransfer } from './useRoutineTransfer';

interface ChatDialogsProps {
  /** 2つのリスト（useRoutineLists の戻り値） */
  lists: ReturnType<typeof useRoutineLists>;
  /** 画像での保存・読み込み（useRoutineTransfer の戻り値） */
  transfer: ReturnType<typeof useRoutineTransfer>;
  consented: boolean | null;
  isScannerOpen: boolean;
  setIsScannerOpen: (open: boolean) => void;
  onScanSuccess: (barcode: string) => true | string;
  isLabelInputOpen: boolean;
  setIsLabelInputOpen: (open: boolean) => void;
  onLabelSubmit: (label: LabelInput) => Promise<boolean | string>;
  /** 閉じたときのフォーカスの戻り先 */
  scanButtonRef: RefObject<HTMLButtonElement | null>;
  labelButtonRef: RefObject<HTMLButtonElement | null>;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  inputRef: RefObject<HTMLInputElement | null>;
}

/** 画面の上に開くもの：スキャナー、成分表示の入力、画像での保存・読み込み、リストの確認、保存のおすすめ */
export const ChatDialogs: React.FC<ChatDialogsProps> = ({
  lists,
  transfer,
  consented,
  isScannerOpen,
  setIsScannerOpen,
  onScanSuccess,
  isLabelInputOpen,
  setIsLabelInputOpen,
  onLabelSubmit,
  scanButtonRef,
  labelButtonRef,
  menuButtonRef,
  inputRef,
}) => {
  const { badProducts, usable, listConflict, setListConflict, moveToList, removeFromOtherList, clearTarget, setClearTarget, clearList } =
    lists;
  const {
    routineExport,
    setRoutineExport,
    routineImport,
    setRoutineImport,
    applyImport,
    isExportReminderOpen,
    setIsExportReminderOpen,
    handleExportImage,
  } = transfer;
  const routineCount = badProducts.length + usable.length;

  return (
    <>
      {/* Barcode Scanner Modal */}
      <BarcodeScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        fallbackFocus={() => scanButtonRef.current}
        onScanSuccess={onScanSuccess}
      />

      <LabelInputModal
        isOpen={isLabelInputOpen}
        onClose={() => setIsLabelInputOpen(false)}
        onSubmit={onLabelSubmit}
        fallbackFocus={() => labelButtonRef.current}
      />

      {routineExport && (
        <RoutineExportDialog
          snapshot={routineExport.snapshot}
          culprits={routineExport.culprits}
          onClose={() => setRoutineExport(null)}
          fallbackFocus={() => menuButtonRef.current}
        />
      )}
      {/* 共有されたルーティンの読み込み（#r=…）は、同意するまで出さない（同意の画面の上に重ねない） */}
      {consented === true && routineImport && (
        <RoutineImportDialog
          snapshot={routineImport.snapshot}
          namesOnly={routineImport.namesOnly}
          hasCurrentLists={routineCount > 0}
          typedLabelsLost={[...badProducts, ...usable.map((e) => e.product)].filter((p) => !isPersistable(p)).length}
          onImport={applyImport}
          onClose={() => setRoutineImport(null)}
          fallbackFocus={() => menuButtonRef.current}
        />
      )}
      {/* もう一方のリストにある製品を登録しようとした：移すか、そのリストから削除するか（1つの製品は1つのリストだけ） */}
      {listConflict && (
        <ChoiceDialog
          title={listConflict.target === 'bad' ? '使えるコスメに登録されています' : '肌荒れしたコスメに登録されています'}
          message={
            listConflict.target === 'bad'
              ? `「${listConflict.product.name}」は【使えるコスメ】に登録されています。1つのコスメは、どちらか1つのリストにだけ登録できます。`
              : `「${listConflict.product.name}」は【肌荒れしたコスメ】に登録されています。1つのコスメは、どちらか1つのリストにだけ登録できます。`
          }
          choices={[
            {
              label: listConflict.target === 'bad' ? '肌荒れしたコスメに移す' : '使えるコスメに移す',
              tone: 'primary',
              onSelect: () => moveToList(listConflict.product, listConflict.target),
            },
            {
              label: listConflict.target === 'bad' ? '使えるコスメから削除' : '肌荒れしたコスメから削除',
              tone: 'secondary',
              onSelect: () => removeFromOtherList(listConflict.product, listConflict.target),
            },
          ]}
          onCancel={() => setListConflict(null)}
          fallbackFocus={() => inputRef.current}
        />
      )}
      {/* リストのクリア（元に戻せないので確かめる） */}
      {clearTarget && (
        <ChoiceDialog
          warning
          title={clearTarget === 'bad' ? '肌荒れしたコスメのリストをクリア' : '使えるコスメのリストをクリア'}
          message={
            clearTarget === 'bad'
              ? `肌荒れしたコスメ（${badProducts.length}点）をリストから削除します。元に戻せません。`
              : `使えるコスメ（${usable.length}点）をリストから削除します。この端末に保存したリストも消え、元に戻せません。`
          }
          choices={[{ label: 'クリアする', tone: 'danger', onSelect: () => clearList(clearTarget) }]}
          onCancel={() => setClearTarget(null)}
          // クリアするとボタンが消えるので、そのリストの見出しへ（引き出しの中。メニューボタンは引き出しの間は押せない）
          fallbackFocus={() =>
            document.getElementById(clearTarget === 'bad' ? BAD_SECTION_ID : USABLE_SECTION_ID)?.querySelector<HTMLElement>('h3') ?? null
          }
        />
      )}
      {/* 比較の結果のあとに1回：リストを画像で保存しませんか？ */}
      {isExportReminderOpen && (
        <ExportReminderDialog
          onExport={(dontShowAgain) => {
            if (dontShowAgain) turnOffExportReminder();
            setIsExportReminderOpen(false);
            handleExportImage();
          }}
          onLater={(dontShowAgain) => {
            if (dontShowAgain) turnOffExportReminder();
            setIsExportReminderOpen(false);
          }}
          fallbackFocus={() => inputRef.current}
        />
      )}
      {/* 画像の QR コードを読むときに html5-qrcode が使う（画面には出さない） */}
      <div id={ROUTINE_QR_READER_ID} hidden />
    </>
  );
};
