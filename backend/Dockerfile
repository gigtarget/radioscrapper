FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
  ffmpeg python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

COPY backend/package*.json ./
RUN npm install

# ---- Python venv + deps (fixes PEP 668) ----
COPY backend/requirements.txt ./
RUN python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

# Ensure the venv python/pip are used by default
ENV PATH="/opt/venv/bin:${PATH}"
# -------------------------------------------

COPY backend/ ./
RUN npm run build

ENV NODE_ENV=production
CMD ["npm","run","start"]
