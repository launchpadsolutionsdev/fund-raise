from app.extensions import db, login_manager
from flask_login import UserMixin
from datetime import datetime, timezone


class User(UserMixin, db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey("tenants.id"))
    email = db.Column(db.String(255), unique=True, nullable=False)
    name = db.Column(db.String(255))
    google_id = db.Column(db.String(255), unique=True)
    avatar_url = db.Column(db.Text)
    role = db.Column(db.String(50), default="viewer")
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    last_login = db.Column(db.DateTime)

    def is_admin(self):
        return self.role == "admin"

    def can_upload(self):
        return self.role in ("admin", "uploader")

    def __repr__(self):
        return f"<User {self.email}>"


@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))
