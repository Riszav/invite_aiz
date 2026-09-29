FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# app is stdlib-only: no pip install needed
COPY app.py server.py index.html admin.html login.html app.js style.css data.js ./

# data/ (SQLite) and uploads/ (photos, music) live on volumes
RUN mkdir -p data uploads && chown -R 1000:1000 data uploads
VOLUME ["/app/data", "/app/uploads"]

USER 1000:1000
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/wishes', timeout=2)" || exit 1

CMD ["python", "server.py", "8080"]
