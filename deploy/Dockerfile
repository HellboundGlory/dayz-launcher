# syntax=docker/dockerfile:1.7
#
# Build context is the repo ROOT, not deploy/: tetra-indexer is a member of the
# root cargo workspace with path dependencies on its siblings, and cargo needs
# every member manifest (src-tauri included) present to resolve the workspace.
#
#   docker build -f deploy/Dockerfile -t tetra-indexer:local .
#
# Requires BuildKit for the cache mounts (default in Docker >= 23).

# Pinned, not floating: a reproducible backend build beats picking up new
# compilers automatically. Move this in step with `[workspace.package]
# rust-version` in the root Cargo.toml (1.86, the floor Cargo.lock's icu 2.2
# imposes). Override for a one-off:
#   docker build --build-arg RUST_IMAGE=rust:1.90-bookworm ...
ARG RUST_IMAGE=rust:1.86-bookworm

FROM ${RUST_IMAGE} AS builder
WORKDIR /app

COPY . .

# rusqlite is `features = ["bundled"]`, so SQLite is compiled from C here. The
# official rust image is buildpack-deps based and already ships gcc/make/libc
# headers — nothing to apt-install.
#
# The binary is written inside the /app/target cache mount, which is not part
# of the layer, so it has to be copied out in the same RUN.
RUN --mount=type=cache,id=tetra-cargo-registry,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,id=tetra-cargo-git,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,id=tetra-indexer-target,target=/app/target,sharing=locked \
    cargo build --release -p tetra-indexer \
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
