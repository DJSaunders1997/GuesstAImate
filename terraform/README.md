# Terraform — GuesstAImate Azure Infrastructure

Manages these Azure resources as code:

| Resource | Terraform address |
|---|---|
| Resource group | `azurerm_resource_group.main` |
| Container Apps managed environment | `azurerm_container_app_environment.main` |
| Container App | `azurerm_container_app.main` |
| Entra app registration | `azuread_application.github_deploy` |
| Service principal | `azuread_service_principal.github_deploy` |
| OIDC federated credential | `azuread_application_federated_identity_credential.github_main` |
| Contributor role assignment | `azurerm_role_assignment.github_deploy_contributor` |
| Firestore database | `google_firestore_database.main` |
| Firestore ruleset | `google_firebaserules_ruleset.firestore` |
| Firestore release | `google_firebaserules_release.firestore` |

**Out of scope:** GitHub Actions workflows (`.github/workflows/`), GHCR image publishing.

---

## Prerequisites

- Terraform ≥ 1.7 — https://developer.hashicorp.com/terraform/install
- Azure CLI logged in: `az login`
- Firebase CLI logged in: `firebase login`  *(used for Firestore auth — no gcloud needed)*
- Contributor (or Owner) on the subscription

---

## Running Terraform locally

**Always use `./tf` instead of `terraform` directly.** The wrapper script reads your Firebase CLI credentials and sets `GOOGLE_OAUTH_ACCESS_TOKEN` automatically, so the Google provider can authenticate to Firestore without needing `gcloud` or a service account key.

```bash
./tf init
./tf plan
./tf apply
./tf import <address> <id>
```

Under the hood it just runs `terraform "$@"` with the env var injected. If your Firebase token has expired, run `firebase login --reauth` first.

---

## Step 1 — Bootstrap Terraform state storage (one-time)

Terraform state cannot manage the storage account that holds its own state.
Run this once, then fill in `backend.tf`.

```bash
LOCATION="<your-region>"     # e.g. eastus — must match your other resources
STATE_RG="tfstate-rg"
# Storage account names: 3-24 chars, lowercase alphanumeric only, globally unique
STATE_SA="tfguesstaimate$(openssl rand -hex 3)"   # e.g. tfguesstaimate4a8c2e

az group create -n "$STATE_RG" -l "$LOCATION"

az storage account create \
  -n "$STATE_SA" \
  -g "$STATE_RG" \
  -l "$LOCATION" \
  --sku Standard_LRS \
  --allow-blob-public-access false \
  --min-tls-version TLS1_2

az storage container create -n tfstate --account-name "$STATE_SA"

echo ""
echo ">>> Update backend.tf: storage_account_name = \"$STATE_SA\""
```

Open `backend.tf` and replace `FILL_IN_AFTER_BOOTSTRAP` with the printed name.

---

## Step 2 — Discover existing resource values

Run these commands to find the values you need for `terraform.tfvars`.

```bash
RG="ContainerApps"

# 1. Subscription ID and tenant ID
az account show --query "{subscription_id: id, tenant_id: tenantId}" -o json

# 2. Location of the resource group
az group show -n "$RG" --query location -o tsv

# 3. Container Apps managed environment name
az containerapp env list -g "$RG" --query "[].name" -o tsv

# 4. Does the environment have a Log Analytics workspace?
ENV_NAME="<paste from step 3>"
az containerapp env show -n "$ENV_NAME" -g "$RG" \
  --query "properties.appLogsConfiguration.logAnalyticsConfiguration" -o json
# If the output is null/empty, set log_analytics_workspace_id = null in tfvars.
# If it has a customerId, find the workspace resource ID:
# az monitor log-analytics workspace list --query "[?customerId=='<customerId>'].id" -o tsv

# 5. Entra app registration used by GitHub Actions
az ad app list --all --query "[].{name:displayName, appId:appId, objectId:id}" -o table

# 6. Service principal object ID for the chosen app
CLIENT_ID="<appId from step 5>"
SP_OBJ_ID=$(az ad sp show --id "$CLIENT_ID" --query id -o tsv)
echo "SP object ID: $SP_OBJ_ID"

# 7. Federated identity credential ID on the app registration
APP_OBJ_ID="<objectId from step 5>"
az ad app federated-credential list --id "$APP_OBJ_ID" \
  --query "[].{name:name, id:id}" -o table

# 8. Role assignment resource ID (Contributor on ContainerApps RG)
SUB_ID="<subscription ID from step 1>"
az role assignment list \
  --assignee "$SP_OBJ_ID" \
  --scope "/subscriptions/$SUB_ID/resourceGroups/$RG" \
  --query "[].id" -o tsv
```

---

## Step 3 — Configure terraform.tfvars

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with values from step 2 — this file is gitignored
```

---

## Step 4 — Initialise

```bash
terraform init
```

---

## Step 5 — Import existing resources

Replace every `<…>` placeholder with the values you discovered in step 2.

```bash
SUB_ID="<subscription-id>"
RG="ContainerApps"
ENV_NAME="<container-app-env-name>"
APP_OBJ_ID="<app-registration-object-id>"
SP_OBJ_ID="<service-principal-object-id>"
FED_CRED_ID="<federated-credential-id>"   # short UUID — from step 7
ROLE_ID="<role-assignment-resource-id>"   # full /subscriptions/... path

terraform import azurerm_resource_group.main \
  "/subscriptions/$SUB_ID/resourceGroups/$RG"

terraform import azurerm_container_app_environment.main \
  "/subscriptions/$SUB_ID/resourceGroups/$RG/providers/Microsoft.App/managedEnvironments/$ENV_NAME"

terraform import azurerm_container_app.main \
  "/subscriptions/$SUB_ID/resourceGroups/$RG/providers/Microsoft.App/containerApps/guesstaimate"

# azuread v3 provider requires /applications/{objectId} prefix
terraform import azuread_application.github_deploy \
  "/applications/$APP_OBJ_ID"

# azuread v3 provider requires /servicePrincipals/{objectId} prefix
terraform import azuread_service_principal.github_deploy \
  "/servicePrincipals/$SP_OBJ_ID"

# Note: singular "federatedIdentityCredential" (not plural)
terraform import azuread_application_federated_identity_credential.github_main \
  "$APP_OBJ_ID/federatedIdentityCredential/$FED_CRED_ID"

terraform import azurerm_role_assignment.github_deploy_contributor "$ROLE_ID"
```

---

## Step 6 — Verify zero drift

```bash
terraform plan
```

The plan should show **no changes** (or only cosmetic differences for unknown-at-import values like secret contents). If you see unexpected changes:

- **`display_name` on the app registration** → update `app_registration_display_name` in `terraform.tfvars` to match the actual name in Azure
- **`log_analytics_workspace_id`** → set it in `terraform.tfvars` if the environment has a linked workspace
- **`template` block changes** → these are safely suppressed by `lifecycle { ignore_changes = [template] }`

---

## Step 7 — Apply changes

```bash
terraform apply
```

---

## Design notes

### Image tag ownership
`lifecycle { ignore_changes = [template] }` on `azurerm_container_app.main` means Terraform deliberately does not touch the running container image or its configuration. The GitHub Actions deploy workflow (`deploy_backend.yml`) owns image updates. Terraform owns everything else: secrets, registry credentials, ingress, and the environment.

### Secrets
`openai_api_key` and `ghcr_password` in `terraform.tfvars` are sensitive and gitignored. The Container Apps API is write-only for secret values — Terraform can set them but cannot read them back, so `terraform plan` will never show a diff for secret values after initial creation.

### Running Terraform in CI
Set the following environment variables (no stored credentials needed — reuse the existing OIDC service principal):

```bash
ARM_CLIENT_ID       = <GUESSTAIMATE_AZURE_CLIENT_ID>
ARM_TENANT_ID       = <GUESSTAIMATE_AZURE_TENANT_ID>
ARM_SUBSCRIPTION_ID = <GUESSTAIMATE_AZURE_SUBSCRIPTION_ID>
ARM_USE_OIDC        = true

# Backend config (pass as -backend-config flags to terraform init)
TF_BACKEND_SA       = <storage account name>
```
