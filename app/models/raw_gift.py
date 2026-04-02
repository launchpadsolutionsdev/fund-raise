from app.extensions import db


class RawGift(db.Model):
    __tablename__ = "raw_gifts"

    id = db.Column(db.Integer, primary_key=True)
    snapshot_id = db.Column(db.Integer, db.ForeignKey("snapshots.id", ondelete="CASCADE"), nullable=False)
    department = db.Column(db.String(50), nullable=False)
    primary_addressee = db.Column(db.String(255))
    appeal_id = db.Column(db.String(255))
    split_amount = db.Column(db.Numeric(12, 2))
    fund_description = db.Column(db.String(255))
    gift_id = db.Column(db.Integer)
    gift_type = db.Column(db.String(100))
    gift_reference = db.Column(db.String(255))
    gift_date = db.Column(db.Date)
    extra_field = db.Column(db.String(255))

    def __repr__(self):
        return f"<RawGift {self.department}/{self.gift_id}>"
