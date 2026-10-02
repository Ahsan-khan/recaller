resource "google_firebase_project" "this" {
  provider = google-beta
  project  = google_project.this.project_id

  depends_on = [google_project_service.this]
}

# The default Hosting site came with Firebase. It serves the email action pages at
# https://<project>.firebaseapp.com/__/auth/action. Firebase can't delete a default site.
resource "google_firebase_hosting_site" "default" {
  provider = google-beta
  project  = google_firebase_project.this.project
  site_id  = var.project_id

  lifecycle {
    prevent_destroy = true
  }
}
