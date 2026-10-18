# syntax=docker/dockerfile:1.7
#
# Build context is the repo ROOT, not deploy/: tetra-indexer is a member of the
# root cargo workspace with path dependencies on its siblings, and cargo needs
# every member manifest (src-tauri included) present to resolve the workspace.
#
#   docker build -f deploy/Dockerfile -t tetra-indexer:local .

# Pinned, not floating: a reproducible backend build beats picking up new
# compilers automatically. Move this in step with `[workspace.package]
# rust-version` in the root Cargo.toml (1.90, which the Tauri plugin crates
# need). Override for a one-off:
#   docker build --build-arg RUST_IMAGE=rust:1.95-bookworm ...
ARG RUST_IMAGE=rust:1.90-bookworm

FROM ${RUST_IMAGE} AS builder
WORKDIR /app

# rusqlite is `features = ["bundled"]`, so SQLite is compiled from C here. The
# official rust image is buildpack-deps based and already ships gcc/make/libc
# headers — nothing to apt-install.

# Dependency layer: manifests and stub targets only, so the registry sources and
# the compiled dependencies stay cached until a Cargo.toml or Cargo.lock changes.
# A cache mount would keep them out of the layers, and so out of the GHA cache.
COPY Cargo.toml Cargo.lock ./
COPY crates/tetra-core/Cargo.toml crates/tetra-core/
COPY crates/tetra-net/Cargo.toml crates/tetra-net/
COPY crates/tetra-registry/Cargo.toml crates/tetra-registry/
COPY crates/tetra-index/Cargo.toml crates/tetra-index/
COPY crates/tetra-indexer/Cargo.toml crates/tetra-indexer/
COPY crates/tetra-steam/Cargo.toml crates/tetra-steam/
COPY crates/tetra-launch/Cargo.toml crates/tetra-launch/
COPY crates/tetra-discord/Cargo.toml crates/tetra-discord/
COPY src-tauri/Cargo.toml src-tauri/
RUN for d in crates/* src-tauri; do mkdir -p "$d/src" && touch "$d/src/lib.rs"; done \
 && rm crates/tetra-indexer/src/lib.rs \
 && echo 'fn main() {}' > crates/tetra-indexer/src/main.rs \
 && cargo build --release -p tetra-indexer

COPY . .

# Cargo judges freshness by mtime, and the copied sources can be older than the
# stub build, so the stub artifacts would be reused. Touching forces the rebuild.
RUN find crates -name '*.rs' -exec touch {} + \
 && cargo build --release -p tetra-indexer \
 && install -D -m 0755 target/release/tetra-indexer /out/tetra-indexer


FROM debian:bookworm-slim AS runtime

# ca-certificates: TLS to api.steampowered.com. curl: HEALTHCHECK only.
# SQLite is statically linked, so there is no libsqlite3 to install.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# Non-root, and it owns /data so the named volume inherits that ownership.
RUN useradd --system --uid 10001 --user-group --home-dir /data \
      --shell /usr/sbin/nologin tetra \
 && mkdir -p /data \
 && chown tetra:tetra /data

COPY --from=builder /out/tetra-indexer /usr/local/bin/tetra-indexer

ENV TETRA_INDEX_DB=/data/index.sqlite \
    TETRA_INDEX_BIND=0.0.0.0:8080 \
    RUST_LOG=info

USER tetra
WORKDIR /data
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8080/v1/health > /dev/null || exit 1

# No CMD: bare entrypoint runs the service, `docker run ... probe` runs the
# one-shot diagnostic.
ENTRYPOINT ["/usr/local/bin/tetra-indexer"]
