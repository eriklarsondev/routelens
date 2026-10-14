from flask import Flask

from .items import bp as items_bp

app = Flask(__name__)


@app.route("/health")
def health():
    return "ok"


@app.route("/items/<int:item_id>", methods=["GET", "DELETE"])
def item(item_id):
    return {"id": item_id}


app.register_blueprint(items_bp, url_prefix="/api/v1")
