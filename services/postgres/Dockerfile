# Keep Alpine/musl and PostgreSQL 16 to preserve the existing data volume's
# locale provider. Switching an existing Alpine cluster to Debian is unsafe.
FROM postgres:16-alpine AS builder
RUN apk add --no-cache build-base git
RUN git clone --branch v0.8.2 --depth 1 https://github.com/pgvector/pgvector.git /tmp/pgvector \
    && cd /tmp/pgvector && make OPTFLAGS="" with_llvm=no && make install with_llvm=no DESTDIR=/vector

FROM postgres:16-alpine
COPY --from=builder /vector/ /
