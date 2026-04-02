from flask import Blueprint, render_template, request
from flask_login import login_required, current_user
from app.services.snapshot_service import (
    get_snapshot_for_date,
    get_available_dates,
    get_department_data,
)

departments_bp = Blueprint("departments", __name__, url_prefix="/departments")

DEPARTMENTS = {
    "annual_giving": "Annual Giving",
    "direct_mail": "Direct Mail",
    "events": "Events",
    "major_gifts": "Major Gifts",
    "legacy_giving": "Legacy Giving",
}


def _get_date_and_snapshot():
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
    return snapshot, available_dates, selected_date


@departments_bp.route("/<dept_slug>")
@login_required
def department(dept_slug):
    if dept_slug not in DEPARTMENTS:
        return "Department not found", 404

    snapshot, available_dates, selected_date = _get_date_and_snapshot()
    dept_data = get_department_data(snapshot, dept_slug) if snapshot else None

    return render_template(
        f"departments/{dept_slug}.html",
        department_name=DEPARTMENTS[dept_slug],
        dept_slug=dept_slug,
        snapshot=snapshot,
        data=dept_data,
        available_dates=available_dates,
        selected_date=selected_date,
    )
