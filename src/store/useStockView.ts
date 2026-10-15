import { useMemo } from 'react';
import { useEditorStore } from './useEditorStore';
import { stockView, type StockView } from '../lib/inventory';

/**
 * The yard as the open drawing sees it - owned, less what the other active
 * drawings hold, or bottomless when this one is unimportant. See `stockView`.
 *
 * Every stock figure on screen goes through this, so the ნაშთი sheet, the bill
 * of materials and the recommendations never disagree about what is free.
 */
export function useStockView(): StockView {
  const documents = useEditorStore((s) => s.documents);
  const activeDocId = useEditorStore((s) => s.activeDocId);
  return useMemo(() => stockView(documents, activeDocId), [documents, activeDocId]);
}
