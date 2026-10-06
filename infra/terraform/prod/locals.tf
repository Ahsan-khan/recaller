locals {
  data_bucket = coalesce(var.data_bucket, "${var.project_id}-data")

  # Firebase serves the email action pages (verify email, reset password) on this domain.
  auth_domain = "${var.project_id}.firebaseapp.com"

  # APIs the backend uses, plus the two Terraform needs to manage the project and its APIs.
  # Firebase turned on a few more by itself; those are left alone.
  services = toset([
    "apikeys.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "firebase.googleapis.com",
    "firebasehosting.googleapis.com",
    "firebaserules.googleapis.com",
    "firebasestorage.googleapis.com",
    "firestore.googleapis.com",
    "identitytoolkit.googleapis.com",
    "securetoken.googleapis.com",
    "serviceusage.googleapis.com",
    "storage.googleapis.com",
  ])

  # The only APIs the app's key works for: sign-in, token refresh, the database and the bucket.
  app_key_services = [
    "identitytoolkit.googleapis.com",
    "securetoken.googleapis.com",
    "firestore.googleapis.com",
    "firebasestorage.googleapis.com",
  ]

  # Firebase's auto-created browser key. The links in verification and password-reset emails carry it, and
  # Firebase's email action page calls Identity Toolkit with it (the API metrics showed exactly that, and nothing
  # else, on 2026-10-01). So it keeps the sign-in APIs and loses the other 25 Firebase had given it.
  email_page_key_services = [
    "identitytoolkit.googleapis.com",
    "securetoken.googleapis.com",
  ]

  labels = {
    app        = "recaller"
    managed-by = "terraform"
  }
}
