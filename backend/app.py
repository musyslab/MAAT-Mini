from __future__ import annotations

import os
from datetime import timedelta
from urllib.parse import quote_plus

from flask import Flask
from flask_cors import CORS

from src.database import db
from src.routes import ai_api, mini_api, submission_api


def _env(name: str, default: str = "") -> str:
    value = os.environ.get(name)
    return value.strip() if value and value.strip() else default


def _env_int(name: str, default: int) -> int:
    raw = _env(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _csv_env(name: str, default: str) -> list[str]:
    return [item.strip() for item in _env(name, default).split(",") if item.strip()]


def _database_uri() -> str:
    user = _env("DB_USER") or _env("MYSQL_USER") or "root"
    password = _env("DB_PASSWORD") or _env("MYSQL_PASSWORD") or _env("MYSQL_ROOT_PASSWORD")
    host = _env("DB_HOST", "127.0.0.1")
    port = _env("DB_PORT") or _env("MYSQL_PORT", "3306")
    database = _env("DB_NAME") or _env("MYSQL_DATABASE") or "tabot"

    return f"mysql+pymysql://{quote_plus(user)}:{quote_plus(password)}@{host}:{port}/{database}"


def create_app() -> Flask:
    app = Flask(__name__)
    app.config.update(
        SQLALCHEMY_DATABASE_URI=_database_uri(),
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_ACCESS_TOKEN_EXPIRES=timedelta(hours=_env_int("JWT_ACCESS_TOKEN_EXPIRES_HOURS", 8)),
        MAX_CONTENT_LENGTH=16 * 1000 * 1000,
    )

    CORS(app, supports_credentials=True, origins=_csv_env("CORS_ORIGINS", "http://localhost:3000"))

    db.init_app(app)
    app.register_blueprint(mini_api, url_prefix="/api/mini")
    app.register_blueprint(submission_api, url_prefix="/api/submissions")
    app.register_blueprint(ai_api, url_prefix="/api/ai")

    with app.app_context():
        db.create_all()

    return app


if __name__ == "__main__":
    create_app().run(host="0.0.0.0", port=5000, debug=_env("FLASK_DEBUG").lower() in {"1", "true", "yes"})
