resource "google_storage_bucket" "data" {
  project                     = google_project.this.project_id
  name                        = local.data_bucket
  location                    = upper(var.region)
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  # A deleted file can be restored for 7 days (Cloud Storage's default, written out).
  soft_delete_policy {
    retention_duration_seconds = 7 * 24 * 60 * 60
  }

  labels = merge(local.labels, { purpose = "user-data" })

  # Kept in state, so Terraform refuses to delete the bucket even if this block is removed.
  deletion_policy = "PREVENT"

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.this]
}

# Lets the Firebase SDK and the storage security rules use the bucket.
resource "google_firebase_storage_bucket" "data" {
  provider  = google-beta
  project   = google_firebase_project.this.project
  bucket_id = google_storage_bucket.data.name
}
