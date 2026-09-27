# SubHub 镜像 (内核 + 统一层打包成单文件, 运行时不依赖 node_modules)
#
# 构建: docker build -t subhub:local .
# 运行: docker run -d --name subhub -p 9635:9635 -v $PWD/data:/app/data subhub:local

FROM node:24-alpine AS builder

WORKDIR /build

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

COPY bundle-esbuild.js jsconfig.json .node-version banner ./
COPY src ./src
COPY config ./config

RUN node bundle-esbuild.js


FROM node:24-alpine AS runtime

WORKDIR /app

ENV SUBHUB_HOME=/app \
    SUB_STORE_DATA_BASE_PATH=/app/data \
    SUB_STORE_BACKEND_API_HOST=0.0.0.0 \
    SUB_STORE_BACKEND_API_PORT=9635

COPY --from=builder /build/dist/sub-store.bundle.js /app/dist/sub-store.bundle.js
COPY --from=builder /build/config /app/config
COPY scripts /app/scripts

RUN mkdir -p /app/data

VOLUME ["/app/data"]
EXPOSE 9635

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.SUB_STORE_BACKEND_API_PORT)+'/api/v1').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "/app/dist/sub-store.bundle.js"]
