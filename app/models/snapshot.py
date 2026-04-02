from app.extensions import db
from datetime import datetime, timezone


class Snapshot(db.Model):
    __tablename__ = "snapshots"

    id = db.Column(db.Integer, primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey("tenants.id"))
    snapshot_date = db.Column(db.Date, nullable=False)
    uploaded_by = db.Column(db.Integer, db.ForeignKey("users.id"))
    uploaded_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    notes = db.Column(db.Text)

    __table_args__ = (
        db.UniqueConstraint("tenant_id", "snapshot_date", name="uq_tenant_snapshot_date"),
    )

    uploader = db.relationship("User", backref="uploads")
    department_summaries = db.relationship("DepartmentSummary", backref="snapshot", cascade="all, delete-orphan")
    gift_type_breakdowns = db.relationship("GiftTypeBreakdown", backref="snapshot", cascade="all, delete-orphan")
    source_breakdowns = db.relationship("SourceBreakdown", backref="snapshot", cascade="all, delete-orphan")
    fund_breakdowns = db.relationship("FundBreakdown", backref="snapshot", cascade="all, delete-orphan")
    raw_gifts = db.relationship("RawGift", backref="snapshot", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Snapshot {self.snapshot_date}>"
