from fastapi import FastAPI

from .routers import orders

app = FastAPI()


@app.get("/health")
def health():
    return {"ok": True}


app.include_router(orders.router, prefix="/api")
