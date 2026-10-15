FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
# Browser sessions protect reads. Railway variables override image defaults.
ENV ALLOW_PUBLIC_READ=false \
    CORS_ALLOWED_ORIGINS=https://zcharmc-monitoring.vercel.app \
    CSRF_TRUSTED_ORIGINS=https://zcharmc-monitoring.vercel.app \
    DJANGO_SECURE_SSL_REDIRECT=true
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# Collecting admin assets needs settings but does not connect to a database.
RUN DJANGO_SECRET_KEY=build-only-not-a-runtime-secret ALLOW_SQLITE=true python manage.py collectstatic --noinput
RUN useradd --create-home appuser && chown -R appuser:appuser /app
USER appuser
CMD ["gunicorn", "config.wsgi:application", "--config", "gunicorn.conf.py"]
