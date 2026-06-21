# ---- Backend build ----
FROM python:3.12-slim AS backend
WORKDIR /app/backend
COPY backend/requirements.txt .

# Install system dependencies including bioinformatics tools
RUN apt-get update && apt-get install -y \
    gcc \
    zlib1g-dev \
    minimap2 \
    samtools \
    bcftools \
    tabix \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir pyabpoa
COPY backend/ .

# ---- Frontend build ----
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json .
RUN npm ci
COPY frontend/ .
RUN npm run build

# ---- Final image ----
FROM python:3.12-slim AS final
WORKDIR /app

# Install runtime bioinformatics tools
RUN apt-get update && apt-get install -y \
    minimap2 \
    samtools \
    bcftools \
    tabix \
    && rm -rf /var/lib/apt/lists/*

COPY --from=backend /app/backend ./backend
COPY --from=backend /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=backend /usr/local/bin/uvicorn /usr/local/bin/uvicorn
COPY --from=backend /usr/local/bin/medaka /usr/local/bin/medaka
COPY --from=backend /usr/local/bin/medaka_consensus /usr/local/bin/medaka_consensus
COPY --from=frontend-build /app/frontend/dist ./backend/static
EXPOSE 8000
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]