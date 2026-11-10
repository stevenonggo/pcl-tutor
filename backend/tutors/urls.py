from django.urls import path

from . import views

# Note: primary keys are MongoDB ObjectIds (24-char hex), so the <str:*>
# converter is used and views validate via queryset lookup (404 otherwise).
urlpatterns = [
    # Availability (published slots)
    path("availability/", views.AvailabilityListView.as_view()),
    path("availability/<str:slot_id>/", views.AvailabilityDetailView.as_view()),
    # Tutor discovery
    path("tutors/", views.TutorListView.as_view()),
    path("tutors/<str:tutor_id>/", views.TutorDetailView.as_view()),
    # Booking
    path("sessions/", views.SessionCreateView.as_view()),
    path("sessions/<str:session_id>/actions/", views.SessionActionView.as_view()),
    # Read models
    path("requests/", views.RequestListView.as_view()),
    path("activity/", views.ActivityListView.as_view()),
    # Profile
    path("profile/", views.ProfileView.as_view()),
    path("profile/become-tutor/", views.BecomeTutorView.as_view()),
]
