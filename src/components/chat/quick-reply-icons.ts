import {
  AlertTriangle,
  CheckCircle2,
  Droplet,
  FileText,
  JapaneseYen,
  Lightbulb,
  RotateCcw,
  ScanBarcode,
  Search,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { QuickReplyIconName } from './quick-replies';

/** クイック返信ボタンの先頭に出す、線のアイコン（ヘッダーのボタンと同じ部品をそろえる） */
export const QUICK_REPLY_ICON_COMPONENTS: Readonly<Record<QuickReplyIconName, LucideIcon>> = {
  scan: ScanBarcode,
  label: FileText,
  search: Search,
  product: Droplet,
  flare: Zap,
  bad: AlertTriangle,
  safe: CheckCircle2,
  price: JapaneseYen,
  retry: RotateCcw,
  idea: Lightbulb,
};
