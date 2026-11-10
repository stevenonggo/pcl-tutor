from django.apps import AppConfig


class TutorsConfig(AppConfig):
    # ObjectId auto fields, matching the project-wide DEFAULT_AUTO_FIELD.
    default_auto_field = "django_mongodb_backend.fields.ObjectIdAutoField"
    name = "tutors"
    verbose_name = "Tutors"
