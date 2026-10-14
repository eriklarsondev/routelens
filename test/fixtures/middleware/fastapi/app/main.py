from fastapi import Depends, FastAPI

from .deps import audit, verify_api_key
from .routers import admin

app = FastAPI(dependencies=[Depends(verify_api_key)])


@app.get("/health")
def health():
    return {"ok": True}


app.include_router(admin.router, prefix="/admin", dependencies=[Depends(audit)])
