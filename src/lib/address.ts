const ADDRESS = /^((?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}):(\d{1,5})$/;

/** The canonical `ip:port` when `text` is an IPv4 address with a port 1–65535, else null. */
export function addressInSearch(text: string): string | null {
  const match = ADDRESS.exec(text.trim());
  if (!match) return null;
  const port = Number(match[2]);
  if (port < 1 || port > 65535) return null;
  return `${match[1]}:${port}`;
}
