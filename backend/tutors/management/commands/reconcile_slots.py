"""Reconcile orphaned slot claims and stale Sealed bookings (rules R1-R8).

Safe to run repeatedly: every mutation is a CAS that matches the exact
state it was computed from, and the time-gated rules only touch aged state.
Use --dry-run to list what would be acted on without mutating.
"""

from django.core.management.base import BaseCommand

from tutors import reconcile


class Command(BaseCommand):
    help = "Reconcile slot claims and stale bookings (R1-R8)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="List affected documents without mutating.",
        )

    def handle(self, *args, **options):
        if options["dry_run"]:
            affected = reconcile.preview_all()
            if not affected:
                self.stdout.write(self.style.SUCCESS("No documents need reconciliation."))
                return
            self.stdout.write("Documents that WOULD be acted on:")
            for rule, pks in sorted(affected.items()):
                self.stdout.write(f"  {rule}: {len(pks)} -> {', '.join(pks[:10])}")
            return

        counts = reconcile.reconcile_all()
        if not counts:
            self.stdout.write(self.style.SUCCESS("Reconciliation complete: nothing to do."))
            return
        for rule, n in sorted(counts.items()):
            self.stdout.write(f"  {rule}: {n}")
        self.stdout.write(self.style.SUCCESS(f"Reconciliation complete ({sum(counts.values())} action(s))."))
