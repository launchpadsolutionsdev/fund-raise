from flask import Blueprint, redirect, url_for, flash, render_template, session
from flask_login import login_user, logout_user, current_user
from app.extensions import db, oauth
from app.models.user import User
from datetime import datetime, timezone

auth_bp = Blueprint("auth", __name__, url_prefix="/auth")


@auth_bp.route("/login")
def login():
    if current_user.is_authenticated:
        return redirect(url_for("dashboard.main"))
    return render_template("login.html")


@auth_bp.route("/login/google")
def login_google():
    redirect_uri = url_for("auth.callback", _external=True)
    return oauth.google.authorize_redirect(redirect_uri)


@auth_bp.route("/callback")
def callback():
    token = oauth.google.authorize_access_token()
    user_info = token.get("userinfo")
    if not user_info:
        flash("Failed to get user info from Google.", "danger")
        return redirect(url_for("auth.login"))

    email = user_info["email"]
    user = User.query.filter_by(email=email).first()

    if not user:
        flash("Access denied. Your email is not registered. Contact an admin.", "danger")
        return redirect(url_for("auth.login"))

    if not user.is_active:
        flash("Your account has been deactivated. Contact an admin.", "danger")
        return redirect(url_for("auth.login"))

    # Update user info from Google
    user.google_id = user_info.get("sub")
    user.name = user_info.get("name", user.name)
    user.avatar_url = user_info.get("picture")
    user.last_login = datetime.now(timezone.utc)
    db.session.commit()

    login_user(user)
    flash(f"Welcome, {user.name}!", "success")

    next_page = session.pop("next", None)
    return redirect(next_page or url_for("dashboard.main"))


@auth_bp.route("/logout")
def logout():
    logout_user()
    flash("You have been logged out.", "info")
    return redirect(url_for("auth.login"))
