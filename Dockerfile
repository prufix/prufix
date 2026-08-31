# syntax=docker/dockerfile:1
# prufix: one image for the GitHub Action and the web validator.
# JRE 21 + Node 20 + official validation artifacts, all fetched at BUILD time
# with pinned versions and SHA256 verification. No network access at runtime.

# --- stage 1: fetch and compile validation artifacts -----------------------
FROM eclipse-temurin:21-jre-noble AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY engine/fetch-deps.sh engine/extract-overrides.xsl /build/engine/
RUN bash /build/engine/fetch-deps.sh /build/out

# --- stage 2: runtime image ------------------------------------------------
FROM eclipse-temurin:21-jre-noble

# xmllint (XSD gate), pdfdetach (Factur-X extraction)
RUN apt-get update \
 && apt-get install -y --no-install-recommends libxml2-utils poppler-utils xz-utils ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Node 20, pinned tarball with checksum verification (linux/amd64)
ADD --checksum=sha256:df770b2a6f130ed8627c9782c988fda9669fa23898329a61a871e32f965e007d \
    https://nodejs.org/dist/v20.20.2/node-v20.20.2-linux-x64.tar.xz /tmp/node.tar.xz
RUN tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
 && rm /tmp/node.tar.xz \
 && node --version

# engine (A)
COPY engine/ /app/engine/
COPY --from=deps /build/out/artifacts /app/artifacts
COPY --from=deps /build/out/tools /app/tools
RUN chmod +x /app/engine/validate.sh

# formatter (B) and action (C)
COPY formatter/ /app/formatter/
COPY action/ /app/action/
RUN if [ -f /app/formatter/package.json ]; then \
      cd /app/formatter && { npm ci --omit=dev || npm install --omit=dev; }; \
    fi \
 && if [ -f /app/action/entrypoint.sh ]; then chmod +x /app/action/entrypoint.sh; fi

# web (D) - same image as the Action. The web has no
# dependencies of its own: the server uses Node built-ins plus [B]'s exports,
# and the rule-page generator reads the dictionary through
# dictionary.loadRules (contract 9.25).
COPY web/ /app/web/

# /rules/<id> is generated at build time, never shipped pre-built: the build is
# the single source of truth for the 30 pages, and the generator hard-fails if
# rules.yaml and web/content/rules/ disagree in either direction (contract 9.19).
RUN rm -rf /app/web/public && node /app/web/tools/gen-rules.mjs

# The Action is the default entrypoint below. The web server is the SAME image
# started with a different command:
#   docker run -p 8080:8080 --entrypoint node <image> /app/web/src/server.js

# Inputs are processed under /tmp only; nothing is persisted in the image.
ENTRYPOINT ["/app/action/entrypoint.sh"]
