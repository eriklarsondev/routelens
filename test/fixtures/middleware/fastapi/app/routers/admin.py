from fastapi import APIRouter, Depends, HTTPException

from ..deps import get_current_user, get_db, require_admin

router = APIRouter(dependencies=[Depends(get_current_user)])


@router.get("/users")
def list_users(db=Depends(get_db)):
    return []


@router.delete("/users/{user_id}", dependencies=[Depends(require_admin)])
def delete_user(user_id: int):
    if user_id == 1:
        raise HTTPException(status_code=403, detail="cannot delete the owner")
    return None
