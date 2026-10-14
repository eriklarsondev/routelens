from flask import Flask, abort, g
from flask_login import login_required

from .admin import bp as admin_bp

app = Flask(__name__)


@app.route("/health")
def health():
    return "ok"


@app.route("/account")
@login_required
def account():
    return {}


@app.route("/export", methods=["POST"])
def export():
    if not g.user or not g.user.is_admin:
        abort(403)
    return "ok"


app.register_blueprint(admin_bp, url_prefix="/admin")
