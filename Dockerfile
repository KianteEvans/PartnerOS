# syntax=docker/dockerfile:1
# PartnerOS production image. Three stages: install deps, build the Next.js
# standalone bundle, then a minimal runtime that runs as a non-root user.
# Real secrets are injected at RUNTIME (never baked into the image); the build
# stage uses schema-valid placeholders because `next build` imports src/env.ts
# to collect page data (see IS_BUILD_PHASE handling there).

# ---- deps -------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Build-time placeholders only (format-valid, obviously fake). Runtime values
# come from the orchestrator / Secrets Manager.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build \
    OIDC_ISSUER=https://build.invalid \
    OIDC_CLIENT_ID=build \
    OIDC_CLIENT_SECRET=build \
    OIDC_REDIRECT_URI=https://build.invalid/api/auth/callback \
    SESSION_JWT_SECRET=build-placeholder-secret-32-bytes-minimum \
    S3_ENDPOINT=https://build.invalid \
    S3_BUCKET=build \
    S3_ACCESS_KEY_ID=build \
    S3_SECRET_ACCESS_KEY=build \
    MALWARE_SCAN_WEBHOOK_SECRET=build
RUN npm run build

# ---- run --------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
