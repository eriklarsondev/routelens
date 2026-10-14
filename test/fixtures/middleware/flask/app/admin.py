from flask import Blueprint
from flask_jwt_extended import jwt_required

bp = Blueprint("admin", __name__)


@bp.before_request
def require_staff():
    pass


@bp.route("/stats")
@jwt_required()
def stats():
    return {}
