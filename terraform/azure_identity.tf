# Entra ID app registration used by the GitHub Actions deploy workflow to
# authenticate to Azure via OIDC (no stored client secret required).

resource "azuread_application" "github_deploy" {
  display_name = var.app_registration_display_name
}

resource "azuread_service_principal" "github_deploy" {
  client_id = azuread_application.github_deploy.client_id
}

# Federated identity credential that trusts GitHub's OIDC token for pushes to
# main (and workflow_dispatch runs triggered from main — same subject claim).
resource "azuread_application_federated_identity_credential" "github_main" {
  application_id = azuread_application.github_deploy.id
  display_name   = "guesstaimate-github-main"
  description    = "GitHub Actions OIDC for GuesstAImate main branch"
  audiences      = ["api://AzureADTokenExchange"]
  issuer         = "https://token.actions.githubusercontent.com"
  subject        = "repo:DJSaunders1997/GuesstAImate:ref:refs/heads/main"
}

# Contributor on the ContainerApps resource group lets the service principal
# create/update Container Apps and their managed environments.
resource "azurerm_role_assignment" "github_deploy_contributor" {
  scope                = azurerm_resource_group.main.id
  role_definition_name = "Contributor"
  principal_id         = azuread_service_principal.github_deploy.object_id
}
