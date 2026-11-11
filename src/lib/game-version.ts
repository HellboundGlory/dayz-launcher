/** The two versions when a server runs a different DayZ build than the installed one, else null. */
export function versionMismatch(
  serverVersion: string,
  installed: string | null,
): { server: string; yours: string } | null {
  const server = serverVersion?.trim() ?? "";
  const yours = installed?.trim() ?? "";
  if (!server || !yours || server === yours) return null;
  return { server, yours };
}
