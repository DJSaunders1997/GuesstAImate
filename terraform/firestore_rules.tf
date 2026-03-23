# The Firestore database already exists; it is imported into state below.
# On first apply, Terraform creates a new ruleset from firestore.rules and
# releases it — replacing the Firebase CLI deploy-rules step in static.yml.
# Subsequent applies only create a new ruleset version when the rules file changes.

resource "google_firestore_database" "main" {
  project     = var.firebase_project_id
  name        = "(default)"
  location_id = "nam5"
  type        = "FIRESTORE_NATIVE"

  # ABANDON means terraform destroy will remove the resource from state without
  # deleting the actual database — protects against accidental data loss.
  deletion_policy = "ABANDON"
}

resource "google_firebaserules_ruleset" "firestore" {
  project = var.firebase_project_id

  source {
    files {
      name    = "firestore.rules"
      content = file("${path.module}/../firestore.rules")
    }
  }
}

resource "google_firebaserules_release" "firestore" {
  project      = var.firebase_project_id
  name         = "cloud.firestore"
  ruleset_name = google_firebaserules_ruleset.firestore.name
}
