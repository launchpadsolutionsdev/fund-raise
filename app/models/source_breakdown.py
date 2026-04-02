from app.extensions import db


class SourceBreakdown(db.Model):
    __tablename__ = "source_breakdowns"

    id = db.Column(db.Integer, primary_key=True)
    snapshot_id = db.Column(db.Integer, db.ForeignKey("snapshots.id", ondelete="CASCADE"), nullable=False)
    department = db.Column(db.String(50), nullable=False)
    source = db.Column(db.String(100), nullable=False)
    amount = db.Column(db.Integer)
    pct_of_gifts = db.Column(db.Numeric(8, 6))

    def __repr__(self):
        return f"<SourceBreakdown {self.department}/{self.source}>"
