from django.contrib.auth.decorators import login_required
from django.urls import include, path

from . import views

urlpatterns = [
    path("health/", views.health),
    path("dashboard/", login_required(views.dashboard)),
    path("shop/", include("shop.urls")),
]
