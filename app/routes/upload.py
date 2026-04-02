import os
import tempfile
from datetime import date as date_type
from flask import Blueprint, render_template, request, flash, redirect, url_for, jsonify
from flask_login import login_required, current_user
from app.extensions import db
from app.models.snapshot import Snapshot
from app.services.excel_parser import parse_department_file
from app.services.snapshot_service import save_department_data

upload_bp = Blueprint("upload", __name__, url_prefix="/upload")

DEPARTMENT_FILES = {
    "annual_giving": "Annual Giving reporting master sheet.xlsx",
    "direct_mail": "Direct Mail reporting master sheet.xlsx",
    "events": "Events reporting master sheet.xlsx",
    "major_gifts": "Major reporting master sheet.xlsx",
    "legacy_giving": "legacy reporting master sheet.xlsx",
}


@upload_bp.route("/", methods=["GET"])
@login_required
def upload_page():
    if not current_user.can_upload():
        flash("You do not have permission to upload data.", "danger")
        return redirect(url_for("dashboard.main"))
    return render_template("upload/upload.html", departments=DEPARTMENT_FILES)


@upload_bp.route("/process", methods=["POST"])
@login_required
def process_upload():
    if not current_user.can_upload():
        return jsonify({"error": "Permission denied"}), 403

    snapshot_date_str = request.form.get("snapshot_date")
    if not snapshot_date_str:
        return jsonify({"error": "Snapshot date is required"}), 400

    parts = snapshot_date_str.split("-")
    snapshot_date = date_type(int(parts[0]), int(parts[1]), int(parts[2]))
    overwrite = request.form.get("overwrite") == "true"

    tenant_id = current_user.tenant_id

    # Check if snapshot exists
    existing = Snapshot.query.filter_by(
        tenant_id=tenant_id, snapshot_date=snapshot_date
    ).first()

    if existing and not overwrite:
        return jsonify({
            "error": "snapshot_exists",
            "message": f"A snapshot already exists for {snapshot_date}. Set overwrite=true to replace it.",
        }), 409

    if existing and overwrite:
        db.session.delete(existing)
        db.session.commit()

    # Create new snapshot
    snapshot = Snapshot(
        tenant_id=tenant_id,
        snapshot_date=snapshot_date,
        uploaded_by=current_user.id,
        notes=request.form.get("notes", ""),
    )
    db.session.add(snapshot)
    db.session.commit()

    results = {}
    errors = {}

    for dept_key, expected_name in DEPARTMENT_FILES.items():
        file = request.files.get(dept_key)
        if not file or file.filename == "":
            continue

        try:
            # Save to temp file
            with tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx") as tmp:
                file.save(tmp.name)
                tmp_path = tmp.name

            # Parse
            parsed = parse_department_file(tmp_path, dept_key)
            save_department_data(snapshot, dept_key, parsed)
            results[dept_key] = "success"

        except Exception as e:
            errors[dept_key] = str(e)
        finally:
            if "tmp_path" in locals() and os.path.exists(tmp_path):
                os.unlink(tmp_path)

    db.session.commit()

    if errors:
        return jsonify({"status": "partial", "results": results, "errors": errors}), 207

    return jsonify({"status": "success", "results": results, "snapshot_id": snapshot.id})
