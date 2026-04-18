FROM denoland/deno:2.6.9

WORKDIR /app
COPY packages ./packages
COPY examples/deno/advanced ./examples/deno/advanced

WORKDIR /app/examples/deno/advanced
RUN deno cache --no-check app.ts

EXPOSE 3000
CMD ["deno", "run", "-A", "--no-check", "app.ts"]
