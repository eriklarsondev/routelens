from django.urls import path

from . import views
from .views import OrderView

urlpatterns = [
    path("products/", views.products),
    path("orders/", OrderView.as_view()),
    path("refunds/", views.RefundList.as_view()),
]
