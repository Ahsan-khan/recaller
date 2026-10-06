resource "google_firestore_database" "default" {
  project     = google_firebase_project.this.project
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  database_edition                  = "STANDARD"
  concurrency_mode                  = "PESSIMISTIC"
  app_engine_integration_mode       = "DISABLED"
  point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_DISABLED"

  # Google refuses to delete the database while delete protection is on. If Terraform is ever
  # told to destroy it, it only forgets it (ABANDON) and the data stays.
  delete_protection_state = "DELETE_PROTECTION_ENABLED"
  deletion_policy         = "ABANDON"

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_firestore_backup_schedule" "daily" {
  project  = google_firestore_database.default.project
  database = google_firestore_database.default.name

  retention = "${var.backup_retention_days * 24 * 60 * 60}s"

  daily_recurrence {}
}
