FROM oven/bun:1.3-alpine

WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY packages ./packages
COPY examples/bun/advanced ./examples/bun/advanced

RUN bun install --frozen-lockfile

WORKDIR /app/examples/bun/advanced

EXPOSE 3000
CMD ["bun", "run", "app.ts"]
