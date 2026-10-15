"""The app must never fall back to a different database engine."""
import os
from pathlib import Path
import runpy
from unittest.mock import patch

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase


class DatabaseSettingsTests(SimpleTestCase):
    def load_settings(self, database_url):
        # Evaluate the real settings without reading a developer's private .env.
        environment = {'DJANGO_SECRET_KEY': 'settings-test-only', 'DATABASE_URL': database_url,
                       'ALLOW_SQLITE': 'true'}  # An obsolete flag must not restore fallback support.
        with patch.dict(os.environ, environment, clear=True), patch('dotenv.load_dotenv'):
            return runpy.run_path(str(Path(settings.BASE_DIR) / 'config/settings.py'))

    def test_database_url_is_required_even_with_obsolete_fallback_flag(self):
        with self.assertRaisesMessage(ImproperlyConfigured, 'Set DATABASE_URL to a PostgreSQL connection URL.'):
            self.load_settings('')

    def test_other_database_engines_are_rejected(self):
        for url in ('sqlite:///:memory:', 'sqlite:///local.db', 'mysql://user:password@localhost/test'):
            with self.subTest(url=url):
                with self.assertRaisesMessage(ImproperlyConfigured, 'DATABASE_URL must point to PostgreSQL.'):
                    self.load_settings(url)

    def test_both_postgresql_url_schemes_select_postgresql(self):
        for scheme in ('postgres', 'postgresql'):
            with self.subTest(scheme=scheme):
                database = self.load_settings(f'{scheme}://local:local@127.0.0.1:5432/test_db')['DATABASES']['default']
                self.assertEqual(database['ENGINE'], 'django.db.backends.postgresql')
                self.assertEqual(database['NAME'], 'test_db')
                self.assertEqual(database['HOST'], '127.0.0.1')
                self.assertEqual(database['CONN_MAX_AGE'], 60)
                self.assertTrue(database['CONN_HEALTH_CHECKS'])
