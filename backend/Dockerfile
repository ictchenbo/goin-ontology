# 后端镜像：Node.js + better-sqlite3（需编译原生模块）
FROM node:20-bookworm-slim AS builder

WORKDIR /app
# 安装编译工具（better-sqlite3 原生模块需要）
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# 生产镜像：仅保留 dist 与生产依赖
FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    DATABASE_PATH=/data/ontology.db \
    PORT=3000

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
# 迁移 SQL 同时放入 dist 与 src 回退路径
COPY src/db/migrations ./src/db/migrations
COPY src/db/migrations ./dist/db/migrations

RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
