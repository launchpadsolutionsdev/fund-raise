from flask import Blueprint, render_template, request
from flask_login import login_required, current_user
from app.services.snapshot_service import get_snapshot_for_date, get_available_dates, get_dashboard_data

dashboard_bp = Blueprint("dashboard", __name__)


@dashboard_bp.route("/")
@login_required
def main():
    tenant_id = current_user.tenant_id
    selected_date = request.args.get("date")
    available_dates = get_available_dates(tenant_id)

    if selected_date:
        from datetime import date as date_type
        parts = selected_date.split("-")
        selected_date = date_type(int(parts[0]), int(parts[1]), int(parts[2]))
    elif available_dates:
        selected_date = available_dates[0]

    snapshot = get_snapshot_for_date(tenant_id, selected_date) if selected_date else None
    dashboard_data = get_dashboard_data(snapshot) if snapshot else None

    return render_template(
        "dashboard/main.html",
        snapshot=snapshot,
        data=dashboard_data,
        available_dates=available_dates,
        selected_date=selected_date,
    )
