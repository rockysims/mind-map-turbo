# Built from the REPO ROOT, not from this directory.
#
# `docker compose up` sets the context accordingly. That matters: the old
# version copied this package's own `package.json` and `pnpm-lock.yaml` into an
# empty image, which is the only reason a second lockfile existed for a package
# the root workspace already locks. Two lockfiles for one package cannot be kept
# in step by hand — any pnpm command run from this directory re-resolved every
# range and silently upgraded the tree — so the build now installs from the same
# lockfile CI does.
#
# ---------- Build stage ----------
FROM node:20-alpine AS builder

RUN corepack enable
WORKDIR /repo

# Workspace metadata first, so a dependency-free source edit reuses this layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/mind-map-sv/package.json apps/mind-map-sv/

RUN pnpm install --frozen-lockfile --filter mind-map-sv...

COPY . .
RUN pnpm --filter mind-map-sv build

# ---------- Runtime stage ----------
#
# A static file server, because `adapter-static` is what `svelte.config.js`
# uses: the build output is a single self-contained `index.html` with no server
# entry at all. The previous runtime stage ran `node build`, which could only
# ever have thrown `ERR_MODULE_NOT_FOUND` — there is no `build/index.js` to run.
#
# When the planned server arrives (a database, sessions, a login), this is the
# stage that changes: swap `adapter-static` for `adapter-node` and run the
# Node output instead. The build stage above stays as it is.
FROM nginx:1.27-alpine AS runner

COPY --from=builder /repo/apps/mind-map-sv/build /usr/share/nginx/html

# Hash routing means every path is served by the one entry document.
RUN printf '%s\n' \
	'server {' \
	'  listen 3000;' \
	'  root /usr/share/nginx/html;' \
	'  location / { try_files $uri /index.html; }' \
	'}' > /etc/nginx/conf.d/default.conf

EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
