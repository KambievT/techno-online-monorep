FROM node:20-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/backend/package.json ./packages/backend/package.json
RUN corepack enable && pnpm install --filter @techno/backend... --frozen-lockfile=false
COPY packages/backend ./packages/backend
WORKDIR /app/packages/backend
EXPOSE 4000
CMD ["pnpm", "start"]
