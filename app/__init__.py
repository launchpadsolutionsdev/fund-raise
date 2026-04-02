import os
import click
from flask import Flask
from dotenv import load_dotenv

load_dotenv()


def create_app():
    app = Flask(__name__)
    app.config.from_object("app.config.Config")

    # Initialize extensions
    from app.extensions import db, migrate, login_manager, oauth

    db.init_app(app)
    migrate.init_app(app, db)
    login_manager.init_app(app)

    # Configure Google OAuth
    oauth.init_app(app)
    oauth.register(
        name="google",
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_id=app.config["GOOGLE_CLIENT_ID"],
        client_secret=app.config["GOOGLE_CLIENT_SECRET"],
        client_kwargs={"scope": "openid email profile"},
    )

    # Import models so they are registered
    from app import models  # noqa: F401

    # Register blueprints
    from app.routes.auth import auth_bp
    from app.routes.dashboard import dashboard_bp
    from app.routes.departments import departments_bp
    from app.routes.upload import upload_bp
    from app.routes.api import api_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(dashboard_bp)
    app.register_blueprint(departments_bp)
    app.register_blueprint(upload_bp)
    app.register_blueprint(api_bp)

    # CLI commands
    @app.cli.command("seed")
    @click.option("--tenant-name", default="Thunder Bay Regional HSF")
    @click.option("--tenant-slug", default="tbrhsf")
    @click.option("--admin-email", required=True, help="Admin user email")
    @click.option("--admin-name", default="Admin")
    def seed(tenant_name, tenant_slug, admin_email, admin_name):
        """Create initial tenant and admin user."""
        from app.models import Tenant, User

        tenant = Tenant.query.filter_by(slug=tenant_slug).first()
        if not tenant:
            tenant = Tenant(name=tenant_name, slug=tenant_slug)
            db.session.add(tenant)
            db.session.commit()
            click.echo(f"Created tenant: {tenant.name}")
        else:
            click.echo(f"Tenant already exists: {tenant.name}")

        user = User.query.filter_by(email=admin_email).first()
        if not user:
            user = User(
                tenant_id=tenant.id,
                email=admin_email,
                name=admin_name,
                role="admin",
            )
            db.session.add(user)
            db.session.commit()
            click.echo(f"Created admin user: {user.email}")
        else:
            click.echo(f"User already exists: {user.email}")

    return app
