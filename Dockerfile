# One Dockerfile, two images:
#   api  the backend (Node 24), run by compose on port 3000 inside the compose network only
#   web  the static app served by an unprivileged nginx on port 8080, which also proxies /api to the api
# `web` is the last stage, so a plain `docker build .` still builds the web image.
# The repo is an npm-workspaces monorepo. The builds call each workspace's own scripts, so
# they do not depend on Turborepo.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY apps/testpage/package.json apps/testpage/
COPY packages/core/package.json packages/core/
COPY packages/contract/package.json packages/contract/
COPY packages/db/package.json packages/db/
COPY packages/voice/package.json packages/voice/
RUN npm ci --ignore-scripts --workspace @kaabil/web --workspace @kaabil/testpage --include-workspace-root
COPY . .
RUN npm run build --workspace @kaabil/web && npm run build --workspace @kaabil/testpage

# The backend runs its TypeScript directly (tsx), so there is no compile step to keep in sync.
FROM node:24-alpine AS api
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY apps/testpage/package.json apps/testpage/
COPY packages/core/package.json packages/core/
COPY packages/contract/package.json packages/contract/
COPY packages/db/package.json packages/db/
COPY packages/voice/package.json packages/voice/
RUN npm ci --omit=dev --ignore-scripts --workspace @kaabil/api --include-workspace-root
COPY packages packages
COPY apps/api apps/api
USER node
EXPOSE 3000
CMD ["node", "--import", "tsx", "apps/api/src/server.ts"]

FROM nginxinc/nginx-unprivileged:1.27-alpine AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
# The plain test page (a family phone and the person's phone, on the real backend) lives next to the app.
COPY --from=build /app/apps/testpage/dist /usr/share/nginx/html/test
EXPOSE 8080
