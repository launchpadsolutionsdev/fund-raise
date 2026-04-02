"""Service layer for snapshot data operations."""

from app.extensions import db
from app.models.snapshot import Snapshot
from app.models.department_summary import DepartmentSummary
from app.models.gift_type_breakdown import GiftTypeBreakdown
from app.models.source_breakdown import SourceBreakdown
from app.models.fund_breakdown import FundBreakdown
from app.models.raw_gift import RawGift


def get_available_dates(tenant_id):
    """Return list of dates with snapshots, most recent first."""
    snapshots = (
        Snapshot.query.filter_by(tenant_id=tenant_id)
        .order_by(Snapshot.snapshot_date.desc())
        .all()
    )
    return [s.snapshot_date for s in snapshots]


def get_snapshot_for_date(tenant_id, date):
    """Get snapshot for a specific date."""
    return Snapshot.query.filter_by(tenant_id=tenant_id, snapshot_date=date).first()


def get_dashboard_data(snapshot):
    """Get combined dashboard data for a snapshot."""
    summaries = DepartmentSummary.query.filter_by(snapshot_id=snapshot.id).all()

    total_raised = 0
    total_gifts = 0
    combined_goal = 0
    departments = {}

    for s in summaries:
        dept_amount = float(s.total_amount) if s.total_amount else 0
        dept_gifts = s.total_gifts or 0
        dept_goal = float(s.goal) if s.goal else 0

        total_raised += dept_amount
        total_gifts += dept_gifts
        combined_goal += dept_goal

        # For events, include third party
        if s.department == "events":
            tp_amount = float(s.third_party_total_amount) if s.third_party_total_amount else 0
            tp_gifts = s.third_party_total_gifts or 0
            tp_goal = float(s.third_party_goal) if s.third_party_goal else 0
            total_raised += tp_amount
            total_gifts += tp_gifts
            combined_goal += tp_goal
            dept_amount += tp_amount
            dept_gifts += tp_gifts
            dept_goal += tp_goal

        departments[s.department] = {
            "total_amount": dept_amount,
            "total_gifts": dept_gifts,
            "goal": dept_goal,
            "pct_to_goal": (dept_amount / dept_goal * 100) if dept_goal else 0,
        }

    overall_pct = (total_raised / combined_goal * 100) if combined_goal else 0

    return {
        "total_raised": total_raised,
        "total_gifts": total_gifts,
        "combined_goal": combined_goal,
        "overall_pct": overall_pct,
        "departments": departments,
    }


def get_department_data(snapshot, department):
    """Get detailed data for a specific department."""
    summary = DepartmentSummary.query.filter_by(
        snapshot_id=snapshot.id, department=department
    ).first()

    gift_types = GiftTypeBreakdown.query.filter_by(
        snapshot_id=snapshot.id, department=department
    ).all()

    sources = SourceBreakdown.query.filter_by(
        snapshot_id=snapshot.id, department=department
    ).all()

    funds = FundBreakdown.query.filter_by(
        snapshot_id=snapshot.id, department=department
    ).all()

    raw_count = RawGift.query.filter_by(
        snapshot_id=snapshot.id, department=department
    ).count()

    return {
        "summary": summary,
        "gift_types": gift_types,
        "sources": sources,
        "funds": funds,
        "raw_count": raw_count,
    }


def save_department_data(snapshot, department, parsed):
    """Save parsed department data to the database."""
    s = parsed["summary"]

    # Department summary
    summary = DepartmentSummary(
        snapshot_id=snapshot.id,
        department=department,
        total_gifts=s.get("total_gifts"),
        total_amount=s.get("total_amount"),
        goal=s.get("goal"),
        pct_to_goal=s.get("pct_to_goal"),
        avg_gift=s.get("avg_gift"),
        new_expectancies=s.get("new_expectancies"),
        open_estates=s.get("open_estates"),
        recorded_expectancies=s.get("recorded_expectancies"),
        third_party_total_gifts=s.get("third_party_total_gifts"),
        third_party_total_amount=s.get("third_party_total_amount"),
        third_party_goal=s.get("third_party_goal"),
        third_party_pct_to_goal=s.get("third_party_pct_to_goal"),
    )
    db.session.add(summary)

    # Gift type breakdowns
    for gt in parsed["gift_types"]:
        db.session.add(GiftTypeBreakdown(
            snapshot_id=snapshot.id,
            department=department,
            gift_type=gt["gift_type"],
            amount=gt.get("amount"),
            pct_of_gifts=gt.get("pct_of_gifts"),
        ))

    # Source breakdowns
    for src in parsed["sources"]:
        db.session.add(SourceBreakdown(
            snapshot_id=snapshot.id,
            department=department,
            source=src["source"],
            amount=src.get("amount"),
            pct_of_gifts=src.get("pct_of_gifts"),
        ))

    # Fund breakdowns
    for fund in parsed["funds"]:
        db.session.add(FundBreakdown(
            snapshot_id=snapshot.id,
            department=department,
            fund_name=fund["fund_name"],
            category=fund.get("category", "primary"),
            amount=fund.get("amount"),
            pct_of_total=fund.get("pct_of_total"),
            onetime_count=fund.get("onetime_count"),
            recurring_count=fund.get("recurring_count"),
            online_count=fund.get("online_count"),
            mailed_in_count=fund.get("mailed_in_count"),
            total_count=fund.get("total_count"),
        ))

    # Raw gifts
    for gift in parsed["raw_gifts"]:
        db.session.add(RawGift(
            snapshot_id=snapshot.id,
            department=department,
            primary_addressee=gift.get("primary_addressee"),
            appeal_id=str(gift["appeal_id"]) if gift.get("appeal_id") is not None else None,
            split_amount=gift.get("split_amount"),
            fund_description=str(gift["fund_description"]) if gift.get("fund_description") is not None else None,
            gift_id=gift.get("gift_id"),
            gift_type=str(gift["gift_type"]) if gift.get("gift_type") is not None else None,
            gift_reference=str(gift["gift_reference"]) if gift.get("gift_reference") is not None else None,
            gift_date=gift.get("gift_date"),
            extra_field=str(gift["extra_field"]) if gift.get("extra_field") is not None else None,
        ))
