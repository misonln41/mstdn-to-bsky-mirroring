FROM denoland/deno:alpine AS builder
ENV DENO_DIR=/deno-dir
WORKDIR /app

COPY deno.json deno.lock ./
RUN deno ci --prod --skip-types

COPY . .

FROM denoland/deno:alpine
ENV DENO_DIR=/deno-dir
WORKDIR /app

COPY --from=builder /app .
COPY --from=builder /deno-dir /deno-dir

USER deno
CMD ["run", "--unstable-cron", "--allow-env", "--allow-net", "--allow-read", "--allow-write", "main.ts"]
