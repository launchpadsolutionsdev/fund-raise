from app.extensions import db


class FundBreakdown(db.Model):
    __tablename__ = "fund_breakdowns"

    id = db.Column(db.Integer, primary_key=True)
    snapshot_id = db.Column(db.Integer, db.ForeignKey("snapshots.id", ondelete="CASCADE"), nullable=False)
    department = db.Column(db.String(50), nullable=False)
    category = db.Column(db.String(50), default="primary")
    fund_name = db.Column(db.String(255), nullable=False)
    amount = db.Column(db.Numeric(12, 2))
    pct_of_total = db.Column(db.Numeric(8, 6))
    # Annual Giving & Direct Mail extra columns
    onetime_count = db.Column(db.Integer)
    recurring_count = db.Column(db.Integer)
    online_count = db.Column(db.Integer)
    mailed_in_count = db.Column(db.Integer)
    total_count = db.Column(db.Integer)

    def __repr__(self):
        return f"<FundBreakdown {self.department}/{self.fund_name}>"
