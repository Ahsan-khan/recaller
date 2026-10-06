output "state_bucket" {
  description = "The bucket to name in every root's gcs backend."
  value       = google_storage_bucket.tfstate.name
}
