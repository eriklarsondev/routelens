from flask import Blueprint

bp = Blueprint("items", __name__)


@bp.route("/items", methods=["POST"])
def create():
    return {}, 201


# Flask 2's shortcut decorators look like FastAPI's, but this is Flask.
@bp.get("/items/<slug>")
def by_slug(slug):
    return {"slug": slug}
