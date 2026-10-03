# LAST CALL — zero-dependency Node image.
# The client is generated geometry and synthesized audio; there is nothing
# to install and nothing to download at runtime.
FROM node:20-alpine

WORKDIR /app
COPY server/ server/
COPY client/ client/
COPY single/ single/
COPY tools/ tools/
COPY package.json README.md ./

ENV PORT=8787 HOST=0.0.0.0
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/health || exit 1

CMD ["node", "server/index.js"]
