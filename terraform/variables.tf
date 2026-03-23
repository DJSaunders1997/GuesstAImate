# -- Azure ---------------------------------------------------------------------

variable "subscription_id" {
  description = "Azure subscription ID (az account show --query id -o tsv)"
  type        = string
}

variable "tenant_id" {
  description = "Azure AD tenant ID (az account show --query tenantId -o tsv)"
  type        = string
}

variable "location" {
  description = "Azure region for all resources (must match existing resources)"
  type        = string
}

# -- Container Apps -------------------------------------------------------------

variable "container_app_environment_name" {
  description = "Name of the existing Container Apps managed environment (az containerapp env list -g ContainerApps --query '[].name' -o tsv)"
  type        = string
}

variable "log_analytics_workspace_id" {
  description = "Log Analytics Workspace resource ID linked to the environment, if any. Set null if the environment has no linked workspace."
  type        = string
  default     = null
}

variable "openai_api_key" {
  description = "OpenAI API key — stored as a Container App secret, never in plaintext config"
  type        = string
  sensitive   = true
}

variable "ghcr_username" {
  description = "GitHub username with read access to ghcr.io/djsaunders1997/guesstaimate"
  type        = string
  default     = "djsaunders1997"
}

variable "ghcr_password" {
  description = "GitHub PAT (classic) with read:packages scope for GHCR"
  type        = string
  sensitive   = true
}

# -- Entra ID -------------------------------------------------------------------

variable "app_registration_display_name" {
  description = "Display name of the Entra app registration used by GitHub Actions (az ad app list --all --query '[].{name:displayName,appId:appId}' -o table)"
  type        = string
}

# -- Firebase / Firestore -------------------------------------------------------

variable "firebase_project_id" {
  description = "Firebase/GCP project ID (visible in firebase.js and Firebase Console)"
  type        = string
  default     = "guesstaimate"
}

variable "google_credentials" {
  description = "Path to a Google service account JSON key file, or the JSON content itself. Null = use Application Default Credentials (run 'gcloud auth application-default login' locally)."
  type        = string
  sensitive   = true
  default     = null
}
