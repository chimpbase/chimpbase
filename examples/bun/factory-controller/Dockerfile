FROM oven/bun:1.3.10-slim

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

COPY . .

EXPOSE 3000

CMD ["bun", "run", "app.ts"]
