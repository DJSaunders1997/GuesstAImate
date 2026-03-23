# Reference the existing managed environment — discovered by name, managed as a resource so
# Terraform tracks it and can recreate it from scratch in a fresh environment.
resource "azurerm_container_app_environment" "main" {
  name                       = var.container_app_environment_name
  resource_group_name        = azurerm_resource_group.main.name
  location                   = azurerm_resource_group.main.location
  log_analytics_workspace_id = var.log_analytics_workspace_id
}

resource "azurerm_container_app" "main" {
  name                         = "guesstaimate"
  resource_group_name          = azurerm_resource_group.main.name
  container_app_environment_id = azurerm_container_app_environment.main.id
  revision_mode                = "Single"

  # -- Secrets ---------------------------------------------------------------
  # Secret values are write-only in the Container Apps API; Terraform manages
  # the names but cannot read back the stored values.
  # Secret names must match the names already present in the live app.
  secret {
    name  = "openai-key"
    value = var.openai_api_key
  }

  secret {
    name  = "ghcrio-djsaunders1997"
    value = var.ghcr_password
  }

  # -- Registry ---------------------------------------------------------------
  registry {
    server               = "ghcr.io"
    username             = var.ghcr_username
    password_secret_name = "ghcrio-djsaunders1997"
  }

  # -- Ingress ----------------------------------------------------------------
  ingress {
    external_enabled = true
    target_port      = 80

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  # -- Container spec ---------------------------------------------------------
  # The image tag is updated on every deploy by the GitHub Actions CD workflow
  # (deploy_backend.yml). The template block is intentionally ignored so that
  # Terraform never reverts a live deployment back to a stale image reference.
  # Terraform owns: secrets, registry credentials, ingress.
  # GitHub Actions owns: the running image tag and container config.
  template {
    container {
      name   = "guesstaimate"
      image  = "ghcr.io/djsaunders1997/guesstaimate:latest"
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name        = "OPENAI_API_KEY"
        secret_name = "openai-key"
      }
    }

    min_replicas = 0
    max_replicas = 1
  }

  lifecycle {
    ignore_changes = [
      # CD pipeline owns the running image tag and container config
      template,
      # Container Apps API is write-only for secrets; Terraform can never read
      # back stored values so will always show false drift here. Secrets are
      # seeded on first apply and then managed out-of-band by the deploy workflow.
      secret,
    ]
  }
}
