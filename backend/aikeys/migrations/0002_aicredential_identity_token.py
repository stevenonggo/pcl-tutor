import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    """Device-identity support for AI credentials.

    ``AiCredential`` now belongs to exactly one of: a PCL Tutor account
    (``user``, via the JWT path) or a login-independent device token
    (``identity_token``; see ``aikeys.identity``). Both fields are nullable
    and unique; the views keep one set per row.
    """

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("aikeys", "0001_initial"),
    ]

    operations = [
        migrations.AlterField(
            model_name="aicredential",
            name="user",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="ai_credential",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="aicredential",
            name="identity_token",
            field=models.CharField(blank=True, max_length=36, null=True, unique=True),
        ),
    ]
