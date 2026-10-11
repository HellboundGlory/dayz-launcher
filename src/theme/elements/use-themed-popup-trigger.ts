import { getThemeOwnedLayout, useLayoutSubscription } from "../theme-store";
import { usePopupTrigger } from "../interaction/use-popup-trigger";
import type { PopupLayoutFile } from "../renderer/types";

export function useThemedPopupTrigger(popupId: string, placement: Parameters<typeof usePopupTrigger>[0]) {
  useLayoutSubscription();
  const themedPopup = getThemeOwnedLayout(`layout/popups/${popupId}.json`) as PopupLayoutFile | undefined;
  return { themedPopup, ...usePopupTrigger(placement, themedPopup) };
}
