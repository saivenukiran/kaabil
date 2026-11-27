# Build the static app, then serve it with an unprivileged nginx on port 8080.
# The repo is an npm-workspaces monorepo (apps/web uses packages/core). The image
# build calls the web workspace's own build script, so it does not depend on Turborepo.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build --workspace @kaabil/web

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
