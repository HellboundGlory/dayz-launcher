import { useShallow } from "zustand/react/shallow";
import { useModsStore, visibleRows } from "@/stores/mods-store";
import { useLaunchStore } from "@/stores/launch-store";
import { useServerStore } from "@/stores/server-store";
import type { Toast, ToastTone } from "@/stores/toast-store";
import { useElementContext } from "./context";
import { resolveActionNoticeContent } from "./notice-elements";

function modsResultText(
  verifyResult: { checked: number; outdated: number; queued: number } | null,
  mutationFailures: [string, string][] | null,
  uniqueResult: { server: string; totalUnique: number; selected: number } | null,
): string {
  const parts: string[] = [];
  if (verifyResult) {
    parts.push(
      `${verifyResult.checked} checked · ${verifyResult.outdated} outdated · ${verifyResult.queued} re-downloading`,
    );
  }
  if (mutationFailures) {
    parts.push(
      mutationFailures.length > 0
        ? `${mutationFailures.length} mod${mutationFailures.length === 1 ? "" : "s"} could not be removed: ${mutationFailures[0][1]}`
        : "Removed ok",
    );
  }
  if (uniqueResult) {
    const { server, totalUnique, selected } = uniqueResult;
    parts.push(
      totalUnique === 0
        ? `No mods are unique to ${server} — every mod it uses is shared with another favourite/recent server.`
        : selected === 0
          ? `${totalUnique} mod${totalUnique === 1 ? " is" : "s are"} unique to ${server}, but none are in your subscribed library — nothing was selected.`
          : selected === totalUnique
            ? `${selected} unique mod${selected === 1 ? "" : "s"} for ${server} selected`
            : `${selected} of ${totalUnique} unique mods for ${server} selected (${totalUnique - selected} not in your library)`,
    );
  }
  return parts.join(" · ");
}

/** Every launcher message that shows as a toast, in the order its source comes to mind. */
export function useNoticeToasts(): Toast[] {
  const {
    storageDegraded,
    error,
    dismissError,
    updateAvailable,
    updateBannerDismissed,
    dismissUpdateBanner,
    openUpdateModal,
  } = useElementContext();
  const {
    error: modsError,
    fromCache,
    verifyResult,
    mutationFailures,
    uniqueResult,
    rows,
    op,
    updateAllOutdated,
    clearVerifyResult,
    clearMutationFailures,
    clearUniqueResult,
  } = useModsStore(
    useShallow((s) => ({
      error: s.error,
      fromCache: s.fromCache,
      verifyResult: s.verifyResult,
      mutationFailures: s.mutationFailures,
      uniqueResult: s.uniqueResult,
      rows: s.rows,
      op: s.op,
      updateAllOutdated: s.updateAllOutdated,
      clearVerifyResult: s.clearVerifyResult,
      clearMutationFailures: s.clearMutationFailures,
      clearUniqueResult: s.clearUniqueResult,
    })),
  );
  const storeNotice = useLaunchStore((s) => s.notice);
  const result = useLaunchStore((s) => s.result);
  const addr = storeNotice?.addr ?? result?.addr ?? null;
  const serverName = useServerStore((s) => {
    if (addr === null) return undefined;
    const row = s.servers.find((server) => server?.addr === addr);
    if (row) return row.name;
    return s.selectedServer?.addr === addr ? s.selectedServer.name : undefined;
  });

  const toasts: Toast[] = [];

  if (storageDegraded) {
    toasts.push({
      key: "notice:storage",
      tone: "error",
      tag: "Storage",
      message:
        "The server database could not be opened. Favourites and recent servers won't be saved this session.",
      closable: false,
    });
  }

  if (error) {
    toasts.push({
      key: `notice:error:${error}`,
      tone: "error",
      tag: "Error",
      message: error,
      onClose: dismissError,
    });
  }

  if (updateAvailable && !updateBannerDismissed) {
    toasts.push({
      key: `notice:update:${updateAvailable.version}`,
      tone: "info",
      tag: "Update",
      title: `Tetra Launcher v${updateAvailable.version}`,
      message: "is ready to install.",
      onClose: dismissUpdateBanner,
      actions: [
        {
          label: "Update",
          primary: true,
          onClick: () => {
            dismissUpdateBanner();
            openUpdateModal();
          },
        },
        { label: "Later", onClick: dismissUpdateBanner },
      ],
    });
  }

  if (addr !== null) {
    const content = resolveActionNoticeContent(addr, storeNotice, result);
    // A successful launch has nothing to report; an action's success line does.
    if (content && !(content.state === "success" && storeNotice?.addr !== addr)) {
      const tone: ToastTone = content.state;
      const tag =
        content.kind === "refusal"
          ? content.title
          : content.kind === "code"
            ? content.code
            : content.state === "success"
              ? "Done"
              : "JOIN";
      const detail = content.kind === "code" ? content.detail : undefined;
      toasts.push({
        key: `notice:launch:${addr}:${content.kind}:${content.message}`,
        tone,
        tag,
        title: serverName,
        message: content.message,
        detail,
        quick: content.state === "success",
        // A quick copy outlives its line, so it only clears the one it was made from.
        onClose: () => {
          const launch = useLaunchStore.getState();
          const current = resolveActionNoticeContent(addr, launch.notice, launch.result);
          if (current?.message !== content.message) return;
          launch.setNotice(addr, null);
          launch.setResult(null);
        },
      });
    }
  }

  if (modsError) {
    toasts.push({
      key: `notice:modsError:${modsError}`,
      tone: "error",
      tag: "Mods",
      message: modsError,
    });
  }

  if (fromCache) {
    toasts.push({
      key: "notice:modsCached",
      tone: "warning",
      tag: "Steam",
      message: "Steam unreachable — showing last known mod list",
    });
  }

  const resultText = modsResultText(verifyResult, mutationFailures, uniqueResult);
  if (resultText) {
    const failed = !!mutationFailures && mutationFailures.length > 0;
    toasts.push({
      key: `notice:modsResult:${resultText}`,
      tone: failed ? "error" : "success",
      tag: "Mods",
      message: resultText,
      quick: !failed,
      onClose: () => {
        const current = useModsStore.getState();
        const currentText = modsResultText(
          current.verifyResult,
          current.mutationFailures,
          current.uniqueResult,
        );
        if (currentText !== resultText) return;
        clearVerifyResult();
        clearMutationFailures();
        clearUniqueResult();
      },
    });
  }

  const outdatedCount = visibleRows(rows).filter((row) => row.state === "needs_update").length;
  if (outdatedCount > 0) {
    const busy = op?.kind === "update";
    toasts.push({
      key: "notice:modsOutdated",
      tone: "warning",
      tag: "Mods",
      message: `${outdatedCount} mod${outdatedCount === 1 ? " needs" : "s need"} updating`,
      actions: [
        {
          label: busy ? (op?.note ?? "Updating…") : "Update all",
          disabled: !!op,
          onClick: () => void updateAllOutdated(),
        },
      ],
    });
  }

  return toasts;
}
