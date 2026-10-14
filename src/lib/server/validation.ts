import 'server-only';
import { UserRoutineState } from '../types';
import { isValidProduct, isValidProductList } from '../product-validation';

export { isValidProduct, isValidProductList };
export const MAX_MESSAGE_LENGTH = 1000;

export function isValidRoutine(r: unknown): r is UserRoutineState {
  if (!r || typeof r !== 'object') return false;
  const routine = r as Record<string, unknown>;
  return (
    isValidProductList(routine.badProducts) &&
    (routine.safeProducts === undefined || isValidProductList(routine.safeProducts)) &&
    (routine.currentlyUsing === undefined || isValidProductList(routine.currentlyUsing))
  );
}
