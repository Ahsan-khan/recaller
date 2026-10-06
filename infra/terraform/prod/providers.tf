# Both providers use the gcloud user login (Application Default Credentials). Called with a user
# login, some Google APIs need a quota project, so every call is billed to this project.

provider "google" {
  project = var.project_id
  region  = var.region

  user_project_override = true
  billing_project       = var.project_id
}

provider "google-beta" {
  project = var.project_id
  region  = var.region

  user_project_override = true
  billing_project       = var.project_id
}
