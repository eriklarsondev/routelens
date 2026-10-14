from django.contrib.auth.decorators import permission_required
from django.contrib.auth.mixins import LoginRequiredMixin
from django.views import View
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAdminUser, IsAuthenticated


@permission_required("shop.view_product")
def products(request):
    return None


class OrderView(LoginRequiredMixin, View):
    def get(self, request):
        return None


class RefundList(ListAPIView):
    permission_classes = [IsAuthenticated, IsAdminUser]
