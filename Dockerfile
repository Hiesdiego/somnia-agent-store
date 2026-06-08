FROM node:22-bookworm-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/companion-agent-sdk/package.json packages/companion-agent-sdk/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/indexer/package.json packages/indexer/package.json
COPY packages/predire-app/package.json packages/predire-app/package.json

RUN pnpm install --frozen-lockfile --filter companion-agent-sdk...

COPY packages/companion-agent-sdk packages/companion-agent-sdk

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["pnpm", "--filter", "companion-agent-sdk", "serve"]
