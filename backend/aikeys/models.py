from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models


class AiCredential(models.Model):
    """One encrypted AI-provider credential per owner.

    An owner is either a PCL Tutor account (``user`` — set when the request
    carries a valid SimpleJWT) or a login-independent device identity
    (``identity_token`` — an unguessable UUID-4 the client generates and
    persists locally; see ``aikeys.identity``). Exactly one of the two is
    set per row, which is what keeps credentials isolated per owner.

    Only the ciphertext is stored (see ``aikeys.crypto``); the plaintext key
    never touches the database, logs, or API responses. ``key_hint`` keeps
    the last four characters so the UI can show *which* key is stored
    without revealing it.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="ai_credential",
    )
    identity_token = models.CharField(
        max_length=36,
        null=True,
        blank=True,
        unique=True,
    )
    provider = models.CharField(max_length=16, default="")
    encrypted_key = models.TextField()
    key_hint = models.CharField(max_length=4, default="")
    validated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "ai_credential"

    def clean(self):
        # A credential must belong to exactly one owner (account or device).
        if self.pk is None and self.user_id is None and not self.identity_token:
            raise ValidationError("A credential needs a user or an identity token.")
