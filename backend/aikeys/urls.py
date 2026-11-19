from django.urls import path

from . import views

urlpatterns = [
    path("providers/", views.AiProviderListView.as_view()),
    path("validate/", views.AiKeyValidateView.as_view()),
    path("status/", views.AiCredentialStatusView.as_view()),
    path("models/", views.AiModelsView.as_view()),
    path("validate-model/", views.AiModelValidateView.as_view()),
]
