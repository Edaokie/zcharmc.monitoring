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
# Static collection loads settings without connecting. These build-only values
# apply to this command; runtime requires the real PostgreSQL DATABASE_URL.
RUN DJANGO_SECRET_KEY=build-only-not-a-runtime-secret DATABASE_URL=postgresql://build:build@127.0.0.1:9/build python manage.py collectstatic --noinput
RUN useradd --create-home appuser && chown -R appuser:appuser /app
USER appuser
CMD ["gunicorn", "config.wsgi:application", "--config", "gunicorn.conf.py"]
