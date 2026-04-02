from app.extensions import db


class DepartmentSummary(db.Model):
    __tablename__ = "department_summaries"

    id = db.Column(db.Integer, primary_key=True)
    snapshot_id = db.Column(db.Integer, db.ForeignKey("snapshots.id", ondelete="CASCADE"), nullable=False)
    department = db.Column(db.String(50), nullable=False)
    total_gifts = db.Column(db.Integer)
    total_amount = db.Column(db.Numeric(12, 2))
    goal = db.Column(db.Numeric(12, 2))
    pct_to_goal = db.Column(db.Numeric(8, 6))
    # Legacy-specific
    avg_gift = db.Column(db.Numeric(12, 2))
    new_expectancies = db.Column(db.Integer)
    open_estates = db.Column(db.Integer)
    recorded_expectancies = db.Column(db.Integer)
    # Events-specific (Third Party)
    third_party_total_gifts = db.Column(db.Integer)
    third_party_total_amount = db.Column(db.Numeric(12, 2))
    third_party_goal = db.Column(db.Numeric(12, 2))
    third_party_pct_to_goal = db.Column(db.Numeric(8, 6))

    def __repr__(self):
        return f"<DepartmentSummary {self.department}>"
