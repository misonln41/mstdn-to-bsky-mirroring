FROM denoland/deno:2.8.3

WORKDIR /app

# These steps will be re-run upon each file change in your working directory:
COPY . .
# Compile the main app so that it doesn't need to be compiled each startup/entry.
RUN deno cache main.ts

# Prefer not to run as root.
USER deno

CMD ["run", "--allow-env", "--allow-net", "--allow-read", "--allow-write", "main.ts"]
