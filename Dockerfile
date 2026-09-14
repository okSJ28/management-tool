FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY tool/ ./tool/

# Container defaults. Override with `docker compose` / `-e` as needed.
ENV DPM_HOST=0.0.0.0 \
    DPM_PORT=8080 \
    DPM_PORT_SCAN=1 \
    DPM_DATA_DIR=/data \
    DPM_FILES_DIR=/data/files \
    DPM_ALLOWED_HOSTS=* \
    DPM_OPEN_BROWSER=0

RUN useradd --system --uid 10001 --create-home appuser \
 && mkdir -p /data/files \
 && chown -R appuser:appuser /data /app

USER appuser
WORKDIR /app/tool

EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/health', timeout=4)"

CMD ["python", "server.py"]
