const JOIN_URL = "https://tetralauncher.com/join";
const MAX_NAME_LENGTH = 100;

/** A server's join page link: the query port, the name and the map, as the site reads them. */
export function joinLink(server: {
  addr: string;
  query_port: number;
  name?: string;
  map?: string;
}): string {
  const params = new URLSearchParams();
  const colon = server.addr.lastIndexOf(":");
  params.set("ip", colon < 0 ? server.addr : server.addr.slice(0, colon));
  params.set("port", String(server.query_port));
  if (server.name) params.set("name", server.name.slice(0, MAX_NAME_LENGTH));
  if (server.map) params.set("map", server.map);
  return `${JOIN_URL}?${params}`;
}
