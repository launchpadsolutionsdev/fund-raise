from flask import Blueprint, jsonify, request
from flask_login import login_required, current_user
from app.models.snapshot import Snapshot
from app.models.department_summary import DepartmentSummary
from app.models.gift_type_breakdown import GiftTypeBreakdown
from app.models.source_breakdown import SourceBreakdown
from app.models.fund_breakdown import FundBreakdown
from app.models.raw_gift import RawGift
from app.services.snapshot_service import get_available_dates

api_bp = Blueprint("api", __name__, url_prefix="/api")

DEPARTMENT_LABELS = {
    "annual_giving": "Annual Giving",
    "direct_mail": "Direct Mail",
    "events": "Events",
    "major_gifts": "Major Gifts",
    "legacy_giving": "Legacy Giving",
}


@api_bp.route("/dates")
@login_required
def dates():
    available = get_available_dates(current_user.tenant_id)
    return jsonify([d.isoformat() for d in available])


@api_bp.route("/snapshot/<date_str>/summary")
@login_required
def snapshot_summary(date_str):
    from datetime import date as date_type
    parts = date_str.split("-")
    d = date_type(int(parts[0]), int(parts[1]), int(parts[2]))
    snapshot = Snapshot.query.filter_by(
        tenant_id=current_user.tenant_id, snapshot_date=d
    ).first()
    if not snapshot:
        return jsonify({"error": "Snapshot not found"}), 404

    summaries = DepartmentSummary.query.filter_by(snapshot_id=snapshot.id).all()
    result = {}
    for s in summaries:
        result[s.department] = {
            "label": DEPARTMENT_LABELS.get(s.department, s.department),
            "total_gifts": s.total_gifts,
            "total_amount": float(s.total_amount) if s.total_amount else 0,
            "goal": float(s.goal) if s.goal else 0,
            "pct_to_goal": float(s.pct_to_goal) if s.pct_to_goal else 0,
        }
        if s.department == "events":
            result[s.department].update({
                "third_party_total_gifts": s.third_party_total_gifts,
                "third_party_total_amount": float(s.third_party_total_amount) if s.third_party_total_amount else 0,
                "third_party_goal": float(s.third_party_goal) if s.third_party_goal else 0,
                "third_party_pct_to_goal": float(s.third_party_pct_to_goal) if s.third_party_pct_to_goal else 0,
            })
        if s.department == "legacy_giving":
            result[s.department].update({
                "avg_gift": float(s.avg_gift) if s.avg_gift else 0,
                "new_expectancies": s.new_expectancies,
                "open_estates": s.open_estates,
            })
    return jsonify(result)


@api_bp.route("/snapshot/<date_str>/gift-types/<department>")
@login_required
def gift_types(date_str, department):
    from datetime import date as date_type
    parts = date_str.split("-")
    d = date_type(int(parts[0]), int(parts[1]), int(parts[2]))
    snapshot = Snapshot.query.filter_by(
        tenant_id=current_user.tenant_id, snapshot_date=d
    ).first()
    if not snapshot:
        return jsonify({"error": "Snapshot not found"}), 404

    breakdowns = GiftTypeBreakdown.query.filter_by(
        snapshot_id=snapshot.id, department=department
    ).all()
    return jsonify([
        {"gift_type": b.gift_type, "amount": b.amount, "pct": float(b.pct_of_gifts) if b.pct_of_gifts else 0}
        for b in breakdowns
    ])


@api_bp.route("/snapshot/<date_str>/sources/<department>")
@login_required
def sources(date_str, department):
    from datetime import date as date_type
    parts = date_str.split("-")
    d = date_type(int(parts[0]), int(parts[1]), int(parts[2]))
    snapshot = Snapshot.query.filter_by(
        tenant_id=current_user.tenant_id, snapshot_date=d
    ).first()
    if not snapshot:
        return jsonify({"error": "Snapshot not found"}), 404

    breakdowns = SourceBreakdown.query.filter_by(
        snapshot_id=snapshot.id, department=department
    ).all()
    return jsonify([
        {"source": b.source, "amount": b.amount, "pct": float(b.pct_of_gifts) if b.pct_of_gifts else 0}
        for b in breakdowns
    ])


@api_bp.route("/snapshot/<date_str>/funds/<department>")
@login_required
def funds(date_str, department):
    from datetime import date as date_type
    parts = date_str.split("-")
    d = date_type(int(parts[0]), int(parts[1]), int(parts[2]))
    snapshot = Snapshot.query.filter_by(
        tenant_id=current_user.tenant_id, snapshot_date=d
    ).first()
    if not snapshot:
        return jsonify({"error": "Snapshot not found"}), 404

    breakdowns = FundBreakdown.query.filter_by(
        snapshot_id=snapshot.id, department=department
    ).all()
    return jsonify([
        {
            "fund_name": b.fund_name,
            "category": b.category,
            "amount": float(b.amount) if b.amount else 0,
            "pct_of_total": float(b.pct_of_total) if b.pct_of_total else 0,
            "onetime_count": b.onetime_count,
            "recurring_count": b.recurring_count,
            "online_count": b.online_count,
            "mailed_in_count": b.mailed_in_count,
            "total_count": b.total_count,
        }
        for b in breakdowns
    ])


@api_bp.route("/snapshot/<date_str>/raw/<department>")
@login_required
def raw_gifts(date_str, department):
    from datetime import date as date_type
    parts = date_str.split("-")
    d = date_type(int(parts[0]), int(parts[1]), int(parts[2]))
    snapshot = Snapshot.query.filter_by(
        tenant_id=current_user.tenant_id, snapshot_date=d
    ).first()
    if not snapshot:
        return jsonify({"error": "Snapshot not found"}), 404

    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 50, type=int)
    search = request.args.get("search", "")

    query = RawGift.query.filter_by(snapshot_id=snapshot.id, department=department)
    if search:
        like_term = f"%{search}%"
        query = query.filter(
            RawGift.primary_addressee.ilike(like_term)
            | RawGift.fund_description.ilike(like_term)
            | RawGift.appeal_id.ilike(like_term)
        )

    pagination = query.order_by(RawGift.gift_date.desc().nullslast()).paginate(
        page=page, per_page=per_page, error_out=False
    )

    return jsonify({
        "gifts": [
            {
                "primary_addressee": g.primary_addressee,
                "appeal_id": g.appeal_id,
                "split_amount": float(g.split_amount) if g.split_amount else 0,
                "fund_description": g.fund_description,
                "gift_id": g.gift_id,
                "gift_type": g.gift_type,
                "gift_reference": g.gift_reference,
                "gift_date": g.gift_date.isoformat() if g.gift_date else None,
                "extra_field": g.extra_field,
            }
            for g in pagination.items
        ],
        "total": pagination.total,
        "page": pagination.page,
        "pages": pagination.pages,
    })


@api_bp.route("/trends")
@login_required
def trends():
    """Return trend data across all snapshots for the trend line chart."""
    tenant_id = current_user.tenant_id
    snapshots = (
        Snapshot.query.filter_by(tenant_id=tenant_id)
        .order_by(Snapshot.snapshot_date)
        .all()
    )

    data = []
    for snap in snapshots:
        summaries = DepartmentSummary.query.filter_by(snapshot_id=snap.id).all()
        entry = {"date": snap.snapshot_date.isoformat(), "departments": {}}
        for s in summaries:
            entry["departments"][s.department] = {
                "total_amount": float(s.total_amount) if s.total_amount else 0,
                "total_gifts": s.total_gifts or 0,
            }
        data.append(entry)

    return jsonify(data)
