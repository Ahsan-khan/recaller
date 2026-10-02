# Accounts and sync (ai_memory/15_accounts_and_sync.md): Firestore field settings, the trash TTL,
# and the Storage rules' read of Firestore.

locals {
  # Fields nobody queries: no single-field indexes (less index storage, no hot index on
  # sequential timestamps). _sync.rev and _sync.deleted stay indexed: the pull queries use them.
  unindexed_fields = {
    notes_text        = { collection = "notes", field = "text" }
    notes_images      = { collection = "notes", field = "images" }
    notes_json        = { collection = "notes", field = "_json" }
    notes_sync_at     = { collection = "notes", field = "_sync.at" }
    projects_json     = { collection = "projects", field = "_json" }
    projects_sync_at  = { collection = "projects", field = "_sync.at" }
    trash_data        = { collection = "trash", field = "data" }
    trash_deleted_at  = { collection = "trash", field = "deletedAt" }
    devices_view      = { collection = "devices", field = "view" }
    devices_drafts    = { collection = "devices", field = "drafts" }
    devices_settings  = { collection = "devices", field = "settings" }
    devices_last_seen = { collection = "devices", field = "lastSeenAt" }
  }
}

resource "google_firestore_field" "unindexed" {
  for_each = local.unindexed_fields

  project    = google_firestore_database.default.project
  database   = google_firestore_database.default.name
  collection = each.value.collection
  field      = each.value.field

  # An empty block turns off every single-field index on this field.
  index_config {}
}

# Deleted notes and projects are kept in users/{uid}/trash for 30 days. Firestore removes each one
# (usually within a day) once expireAt has passed. TTL deletes are billed as ordinary deletes.
resource "google_firestore_field" "trash_expire_at" {
  project    = google_firestore_database.default.project
  database   = google_firestore_database.default.name
  collection = "trash"
  field      = "expireAt"

  ttl_config {}
  index_config {}
}

# The Storage rules read users/{uid} in Firestore (the "deleting" flag) before an upload or a delete.
# That cross-service read needs this role on the Firebase Storage service agent. google_project_iam_member
# is additive: it adds this one binding and never touches anyone else's access.
resource "google_project_iam_member" "storage_rules_read_firestore" {
  project = google_project.this.project_id
  role    = "roles/firebaserules.firestoreServiceAgent"
  member  = "serviceAccount:service-${google_project.this.number}@gcp-sa-firebasestorage.iam.gserviceaccount.com"

  depends_on = [google_firebase_storage_bucket.data]
}
