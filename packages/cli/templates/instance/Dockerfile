# syntax=docker/dockerfile:1.7

# One image for every process of this instance. The `@manablox/*` packages are compiled
# JavaScript, and the project's own TypeScript (configs, plugins) is loaded by the
# `manablox` CLI through tsx. There is nothing to compile, so the runtime layer is
# node_modules plus the project files; .dockerignore keeps out state and secrets.

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

FROM base AS deps
WORKDIR /app
# `CI` keeps pnpm non-interactive.
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Production dependencies only: typescript and @types/node are for `pnpm typecheck` on a
# workstation, and the CLI needs neither.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
{{#if sqlite}}
# Non-root. The database, the uploads and the media cache are volumes owned by this
# user; the application directory itself is not writable.
{{#else}}
# Non-root. The uploads and the media cache are volumes owned by this user; the
# application directory itself is not writable.
{{/if}}
RUN groupadd --system --gid 1001 manablox \
 && useradd --system --uid 1001 --gid manablox manablox \
 && mkdir -p /data/uploads /data/media-cache{{#if sqlite}} /data/db{{/if}} \
 && chown -R manablox:manablox /data
COPY --from=deps --chown=manablox:manablox /app/node_modules ./node_modules
COPY --chown=manablox:manablox . ./
USER manablox

ENV PORT=3000
EXPOSE __EXPOSE_PORTS__
{{slot dockerfile.expose}}
# `/readyz` checks the database; a process that cannot reach it reports unhealthy.
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/node_modules/.bin/manablox"]
CMD ["start"]
