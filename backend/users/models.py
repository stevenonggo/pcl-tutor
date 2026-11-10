from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    # P0 profile fields (additive; every field has a safe default so existing
    # endpoint behavior is unchanged).
    role = models.CharField(max_length=16, default="student")  # 'student' | 'tutor'
    full_name = models.CharField(max_length=100, blank=True, default="")
    major = models.CharField(max_length=100, blank=True, default="")
    semester = models.CharField(max_length=4, blank=True, default="")
    bio = models.TextField(blank=True, default="")
    subjects = models.JSONField(default=list)
    accent = models.CharField(max_length=32, blank=True, default="")
    rating = models.FloatField(default=0.0)
    sessions_count = models.IntegerField(default=0)
    is_demo = models.BooleanField(default=False)