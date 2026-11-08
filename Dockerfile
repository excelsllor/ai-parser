# syntax=docker/dockerfile:1.7

FROM rust:1.99-bookworm AS builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        cmake=3.25.1-1 \
        libcurl4-openssl-dev=7.88.1-10+deb12u15 \
        libssl-dev=3.0.22-1~deb12u2 \
        pkg-config=1.8.1-1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --locked --release --bins \
    && mkdir -p /out \
    && cp target/release/gateway target/release/collector target/release/normalizer \
          target/release/analyst target/release/critic target/release/reporter /out/

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates=20250419~deb12u2 \
        curl=7.88.1-10+deb12u15 \
        libssl3=3.0.22-1~deb12u2 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 10001 app \
    && useradd -u 10001 -g app -r -s /usr/sbin/nologin app \
    && mkdir -p /data /app/web \
    && chown -R app:app /data /app

COPY --from=builder /out/ /usr/local/bin/
COPY frontend/dist /app/web

ENV DATA_DIR=/data \
    FRONTEND_DIR=/app/web \
    RUST_LOG=info

USER 10001:10001
EXPOSE 8080 50051

CMD ["/usr/local/bin/gateway"]
