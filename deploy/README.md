# tetra-indexer — operator runbook

`tetra-indexer` crawls the Steam master server list for DayZ (appid 221100),
probes every address it finds over A2S, and serves the resulting server index
over HTTP. Launchers read the index instead of running their own 17-minute
Steam matchmaking pass.

One instance is enough for any number of clients. It is stateless apart from a
SQLite file that a single crawl cycle can rebuild.

---

## Prerequisites

- Ubuntu 22.04 or 24.04 (any Linux with Docker works).
- Docker Engine 23+ with Compose v2: `docker compose version`.
- A Steam Web API key: <https://steamcommunity.com/dev/apikey>. The account
  does **not** need to own DayZ, and this server does **not** need Steam
  installed — `GetServerList` is a plain HTTPS call.
- Outbound **UDP** to arbitrary ports must not be blocked. A2S_INFO and
  A2S_RULES are UDP; some budget VPS providers filter high-fanout outbound UDP
  as DDoS traffic. Verify with `probe` before you commit to a host.
- ~2 GB disk for the image, plus the DB (see *Disk growth* below).
- 1 vCPU / 1 GB RAM is enough; the sweep is I/O bound, not CPU bound.

## First run

```sh
cd deploy
cp .env.example .env
${EDITOR:-nano} .env            # set STEAM_API_KEY
```

The image is published to GitHub Container Registry, so `docker compose up`
pulls it — no build, no repo checkout on the VPS. (The repo itself is
public; the pull needs no login.) The image is rebuilt and re-published by CI
on every `v*` release tag — `:latest` always points at the newest release.

```sh
docker compose up -d        # pulls ghcr.io/hellboundglory/dayz-launcher:latest
docker compose logs -f indexer
```

To run from a local checkout instead (development, or a VPS that cannot
reach GHCR): `docker compose up -d --build`.

Verify the key and the network **before** starting the service:

```sh
docker compose run --rm indexer probe
```

`probe` is a one-shot diagnostic (the image is built on first use): it makes a
handful of Steam Web API calls plus a small A2S sample, prints what it measured
and exits. Expected shape (measured live, 2026-09-09):

| Check | Expected |
|---|---|---|
| Per-request row cap | exactly 10,000 (`limit=20000` returns 9,999–10,000) |
| Hot request `\\appid\\221100\\empty\\1` | 2,507 rows in ~2.0 s |
| Full crawl | 1,249 requests, 324,156 unique addresses, ~158 s at 16-way concurrency |
| A2S_INFO answer rate (random sample) | 98% (488 / 500) |
| Retained after the same-IP cap | ~30,000+ servers, every populated one kept |
| Snapshot served | ~0.9 MB gzipped, ~19 MB JSON |

Counts drift with the live browser; orders of magnitude are what matter. A row
cap far below 10,000, an answer rate near 0%, or a 401/403 from Steam means the
key or the network is wrong — fix that before starting the service.

Then start it:

```sh
docker compose up -d --build
docker compose ps                      # healthy after the first crawl
curl -s localhost:8080/v1/health | jq
```

`/v1/health` reports `servers`, `responsive`, `withMods`, `populated` and the
`last*Pull` / `last*Sweep` timestamps. `servers` climbs during the first full
crawl and `withMods` fills in over the following few rules sweeps — a fully
warm index takes roughly an hour, not a minute.

Endpoints:

| Path | Purpose |
|---|---|
| `/v1/health` | liveness + index freshness |
| `/v1/servers/snapshot` | whole index; supports `ETag` / `If-None-Match` |
| `/v1/servers/delta?since=<unix>` | rows changed since a cursor |
| `/v1/servers/<ip:queryport>` | one server plus its mod list |

## Pointing a launcher at it

Baked in at **build time** — there is deliberately no runtime setting, so a
launcher and its backend move together:

```sh
TETRA_INDEX_URL=https://index.example.com npx tauri build --debug
```

The release pipeline does this from the `TETRA_INDEX_URL` Actions variable
(repo → Settings → Secrets and variables → Actions). A build without the
URL simply runs its own Steam pass; the launcher falls back to it
automatically whenever the backend is unreachable or stale. The URL is
scheme + host, no path — the client appends the `/v1/...` paths itself.

## TLS / reverse proxy

The container publishes `127.0.0.1:8080` only. Terminate TLS in front of it.

**Caddy** (`/etc/caddy/Caddyfile`) — certificates are automatic:

```caddyfile
index.example.com {
	encode gzip
	reverse_proxy 127.0.0.1:8080
}
```

**nginx** (`/etc/nginx/sites-available/tetra-index`, then `certbot --nginx`):

```nginx
server {
	listen 443 ssl http2;
	server_name index.example.com;

	ssl_certificate     /etc/letsencrypt/live/index.example.com/fullchain.pem;
	ssl_certificate_key /etc/letsencrypt/live/index.example.com/privkey.pem;

	# The snapshot is ~19 MB uncompressed; let it stream rather than buffer.
	proxy_buffering off;

	location / {
		proxy_pass http://127.0.0.1:8080;
		proxy_http_version 1.1;
		proxy_set_header Host $host;
		# The rate limiter keys on the client address, so it must see the real one.
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_read_timeout 120s;
	}
}
```

Both already handle gzip; the service also gzips the snapshot itself, so do not
double-compress if you tune this further.

## Logs

```sh
docker compose logs -f indexer            # follow
docker compose logs --since 1h indexer    # recent
docker compose logs -n 200 indexer        # tail
```

Rotation is configured in `docker-compose.yml` (`json-file`, 10 MB × 5). Raise
verbosity with `RUST_LOG=info,tetra_indexer=debug` in `.env`, then
`docker compose up -d` (recreates the container; no rebuild).

## Upgrading

```sh
cd /path/to/dayz-launcher
git pull
cd deploy
docker compose up -d --build
docker image prune -f            # drop the superseded image
```

The volume is untouched, so the index survives. If a release changes the wire
format, `format_version` changes with it: clients discard a mismatched body
rather than migrating it, so old launchers stop reading the index until they
are updated. Nothing to do server-side.

The builder toolchain is pinned (`ARG RUST_IMAGE=rust:1.86-bookworm`) rather
than floating, so a new stable compiler cannot break the image on its own. That
pin must move whenever `[workspace.package] rust-version` in the root
`Cargo.toml` does — otherwise the build fails with "rustc … is not supported by
the following packages".

## Backup and restore

**Backup is optional.** The database is fully regenerable — one crawl cycle
rebuilds it from Steam, and the only thing lost is the mod/description backlog
that the rules sweep refills over the next hour. There is no user data in it.

If you want a copy anyway (SQLite must not be copied while being written, so
stop the service first):

```sh
docker compose stop indexer
docker run --rm -v deploy_index-data:/data -v "$PWD:/backup" debian:bookworm-slim \
	tar czf /backup/tetra-index-$(date +%F).tar.gz -C /data .
docker compose start indexer
```

Restore into a fresh volume:

```sh
docker compose down
docker volume rm deploy_index-data
docker volume create deploy_index-data
docker run --rm -v deploy_index-data:/data -v "$PWD:/backup" debian:bookworm-slim \
	tar xzf /backup/tetra-index-YYYY-MM-DD.tar.gz -C /data
docker compose up -d
```

Volume names are prefixed with the compose project name (the directory name,
`deploy`, unless you set `-p`); confirm with `docker volume ls`.

## Host tuning (outside Docker)

`ulimits.nofile` is already set in `docker-compose.yml`, which also carries the
per-container (namespaced) sysctls, commented out. The values below are
host-level and cannot be set per container — add them to
`/etc/sysctl.d/99-tetra-indexer.conf` and run `sudo sysctl --system`:

```conf
# Each of the up-to-TETRA_MAX_IN_FLIGHT concurrent probes creates a conntrack
# entry; the default table fills and the kernel logs
# "nf_conntrack: table full, dropping packet".
net.netfilter.nf_conntrack_max = 262144
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
```

The conntrack hash-bucket count is a module parameter, not a sysctl — put it in
`/etc/modprobe.d/nf_conntrack.conf` and reboot (or reload the module):

```conf
options nf_conntrack hashsize=65536
```

If the host has no conntrack pressure and no NAT gateway in front of it, you can
skip all of this; watch `dmesg` and `conntrack -C` before tuning blind.

## Being a good neighbour

The A2S sweep is high-fanout outbound UDP from a single IP — tens of thousands
of small packets to tens of thousands of hosts every few minutes. That is
exactly the shape of a UDP scan, and it will be reported as one.

- Set **reverse DNS** on the server's IP to something identifiable
  (`tetra-index.example.com`), and publish an **abuse contact** on that host so
  a complaint reaches you rather than your provider's null-route script.
- Tell your provider up front what the traffic is. Some ToS forbid scanning
  outright.
- **Honour opt-out requests.** If a host or server owner asks to be excluded,
  exclude them — do not argue that the data is public.
- Do not lower the sweep intervals to "get fresher data". The defaults are
  already at the point where the marginal freshness is not worth the extra
  packets.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Container exits immediately, log says the Steam key is missing | `STEAM_API_KEY` empty or `.env` not found | `.env` must sit next to `docker-compose.yml`; `docker compose config` shows the resolved env. Re-run `docker compose up -d` after editing — `restart` does not reload `.env`. |
| Steam calls start returning 429/403, `last_full_pull` stops advancing | Web API quota (~100k calls/day/key) exhausted | A full crawl measured 1,249 requests: `86400 / TETRA_FULL_INTERVAL_SECS * 1249` must stay well under 100k. At the default 1200 s that is ~90k/day — deliberately near the ceiling. Raise `TETRA_FULL_INTERVAL_SECS` (every +600 s saves ~43k/day); do not run two indexers on one key. |
| `servers` grows but `responsive` stays ~0 | Provider filters outbound UDP, or egress rules block it | `docker compose run --rm indexer probe` from that host; compare with another network. Check `iptables -L OUTPUT`/`ufw status` and the provider's DDoS-protection settings. If the provider will not allow it, move the indexer. |
| `nf_conntrack: table full, dropping packet` in `dmesg`; answer rate drops under load | Conntrack table too small for the probe fanout | Apply the host tuning above, and/or lower `TETRA_MAX_IN_FLIGHT`. |
| "Too many open files" in the log | fd limit below `TETRA_MAX_IN_FLIGHT` | `ulimits.nofile` in `docker-compose.yml` is 65536; if you changed it, put it back, then `docker compose up -d`. |
| Disk growth: volume much larger than the ~29k servers the API serves | The SQLite DB keeps every address ever seen, including the advert farms the same-IP cap excludes from the API (273k addresses from 8,014 IPs; 88 IPs account for 186k of them). It only ever grows. | Nothing is lost by resetting: the DB is fully regenerable from one crawl cycle. `docker compose down && docker volume rm deploy_index-data && docker compose up -d`. Log rotation is already capped at 50 MB. |
| Clients see 429 | `TETRA_RATE_LIMIT_PER_MIN` (default 60/min per client IP) | Expected for a shared NAT or a misbehaving client. If a reverse proxy is in front, make sure it forwards the real client address (see the nginx snippet) or every client counts as one. Raise the limit only if the traffic is legitimate. |
| `/v1/health` reachable but a launcher shows no servers | `format_version` mismatch, or the baked URL includes a path | Compare `formatVersion` in `/v1/health` with the launcher's build. `TETRA_INDEX_URL` must be scheme + host only (no `/v1/...`). |
| `docker build` fails with "rustc … is not supported by the following packages" | Pinned `RUST_IMAGE` older than the lockfile's MSRV | Drop the `--build-arg RUST_IMAGE=…` override, or pin a newer `rust:<ver>-bookworm`. |
