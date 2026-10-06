output "app_config" {
  description = "What the app needs to reach the backend. Sensitive: it holds the API key."
  sensitive   = true
  value = {
    projectId     = google_project.this.project_id
    apiKey        = google_apikeys_key.app.key_string
    storageBucket = google_firebase_storage_bucket.data.bucket_id
    authDomain    = local.auth_domain
    region        = var.region
  }
}
