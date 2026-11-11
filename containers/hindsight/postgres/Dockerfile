FROM groonga/pgroonga:4.0.8-debian-17
RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-17-pgvector=0.8.6-1.pgdg13+1 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
