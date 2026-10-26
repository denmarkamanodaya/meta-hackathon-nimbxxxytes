# syntax=docker/dockerfile:1
# API image: cargo-chef caches the dependency build in its own layer, so a source-only change
# rebuilds only the workspace crates. Builds natively on arm64 (Mac and the t4g box).

FROM rust:1.99.1-slim-trixie AS chef
# The toolchain file asks for rustfmt + clippy; the image build needs neither.
ENV RUSTUP_TOOLCHAIN=1.99.1
# ONNX Runtime (statically linked by ort) is C++, so linking needs libstdc++.
RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ \
    && rm -rf /var/lib/apt/lists/*
RUN cargo install cargo-chef --locked --version 0.1.78
WORKDIR /app

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json
COPY . .
RUN cargo build --release --locked --bin nimbytes-server

FROM debian:trixie-slim AS runtime
# Debian's ffmpeg is built with libass (burned-in captions) and libx264.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN useradd --system --uid 10001 --create-home --shell /usr/sbin/nologin nimbytes
COPY --from=builder /app/target/release/nimbytes-server /usr/local/bin/nimbytes-server
USER nimbytes
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/nimbytes-server"]
