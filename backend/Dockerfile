FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
# Approved cloud demo: public reads while the dashboard still uses mock login.
# Railway service variables override these non-secret image defaults.
# Remove public reads when real dashboard authentication is implemented.
ENV ALLOW_PUBLIC_READ=true \
    CORS_ALLOWED_ORIGINS=https://zcharmc-monitoring.vercel.app
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# Collecting admin assets needs settings but does not connect to a database.
RUN DJANGO_SECRET_KEY=build-only-not-a-runtime-secret ALLOW_SQLITE=true python manage.py collectstatic --noinput
RUN useradd --create-home appuser && chown -R appuser:appuser /app
USER appuser
CMD ["gunicorn", "config.wsgi:application", "--config", "gunicorn.conf.py"]
