# Security rules come from ../../firebase/*.rules: edit a file, then plan and apply.
#
# A ruleset can't be changed, and the provider can't re-point a release in place. So a rules
# change creates the new ruleset first (rules that don't compile fail here, before anything live
# changes), then re-creates the release on it, then deletes the old ruleset.
#
# The rules are uploaded byte for byte, so line endings are normalized to LF: a CRLF checkout on
# Windows then plans no change (../../.gitattributes also keeps these files LF).

resource "google_firebaserules_ruleset" "firestore" {
  project = google_firebase_project.this.project

  source {
    files {
      name    = "firestore.rules"
      content = replace(file("${path.module}/../../firebase/firestore.rules"), "\r\n", "\n")
    }
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_firebaserules_release" "firestore" {
  project      = google_firebase_project.this.project
  name         = "cloud.firestore"
  ruleset_name = "projects/${var.project_id}/rulesets/${google_firebaserules_ruleset.firestore.name}"

  depends_on = [google_firestore_database.default]
}

resource "google_firebaserules_ruleset" "storage" {
  project = google_firebase_project.this.project

  source {
    files {
      name    = "storage.rules"
      content = replace(file("${path.module}/../../firebase/storage.rules"), "\r\n", "\n")
    }
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_firebaserules_release" "storage" {
  project      = google_firebase_project.this.project
  name         = "firebase.storage/${google_firebase_storage_bucket.data.bucket_id}"
  ruleset_name = "projects/${var.project_id}/rulesets/${google_firebaserules_ruleset.storage.name}"
}
