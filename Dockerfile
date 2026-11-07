# syntax=docker/dockerfile:1.7

FROM rust:1.99-bookworm AS builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        cmake libcurl4-openssl-dev libssl-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY web ./web

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release --bins \
    && mkdir -p /out \
    && cp target/release/gateway target/release/collector target/release/normalizer \
          target/release/analyst target/release/critic target/release/reporter /out/

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl libssl3 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 10001 app \
    && useradd -u 10001 -g app -r -s /usr/sbin/nologin app \
    && mkdir -p /data /app/web \
    && chown -R app:app /data /app

COPY --from=builder /out/ /usr/local/bin/
COPY web /app/web

ENV DATA_DIR=/data \
    FRONTEND_DIR=/app/web \
    RUST_LOG=info

USER 10001:10001
EXPOSE 8080

CMD ["/usr/local/bin/gateway"]
