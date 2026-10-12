from fastapi import APIRouter, FastAPI

app = FastAPI()
router = APIRouter(prefix="/reports")


@router.get("/{report_id}")
def get_report(report_id: str):
    return {"id": report_id}


@router.post("/")
def create_report():
    # @router.delete("/{report_id}") <- commented out, must not be detected
    return {}


app.include_router(router)
