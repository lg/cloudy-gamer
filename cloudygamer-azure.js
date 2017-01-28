(async function(){}) /* JustInTimeBabel will re-run this script */

const RESOURCE_GROUP_NAME = "cloudygamer"
const RESOURCE_NAME_PREFIX = "cloudygamer"
const VM_NAME = "cloudygamervm"

class CloudyGamerAzure {
  constructor(config) {
    this.config = config

    this.adal = new AuthenticationContext({
      tenant: this.config.tenant,     // aka directory id
      clientId: this.config.clientId,
      endpoints: {"azuremanagement": "https://management.azure.com/"},
      cacheLocation: "localStorage",
      postLogoutRedirectUri: window.location,
      popUp: true
    });
    this.adal.CONSTANTS.LOADFRAME_TIMEOUT = '30000'

    if (this.adal.isCallback(window.location.hash))
      this.adal.handleWindowCallback();
  }

  async azureRequest(method, resource, body=null) {
    if (!this.adal.getCachedUser()) {
      throw new Error("Not logged into Azure")
    }

    // Load token if it's missing
    let token = this.adal.getCachedToken("https://management.azure.com/")
    if (!token) {
      console.log("Getting adal token...")
      token = await new Promise((resolve, reject) => {
<<<<<<< HEAD
        const adal = this.adal
        this.adal.acquireToken("https://management.azure.com/", (error, token) => {
          if (!error) {
            resolve(token)
          } else {
            if (error.includes("AADSTS50058")) {
              console.log("You seem logged out, logging back in...")
              adal.login()
            }
            reject(error)
          }
        })
=======
        this.adal.acquireToken("https://management.azure.com/", (error, token) => { if (error) { debugger ; reject(error) } else { resolve(token) } })
>>>>>>> parent of ddb0524... removed azure items from master, still available in azure branch
      })
    }

    // Load subscription id if it's missing (and required for this call)
    if (resource.includes("{subscriptionId}") && !this.subscriptionId) {
      this.subscriptionId = (await this.azureRequest("GET", "/subscriptions?api-version=2014-04-01"))[0].subscriptionId
    }

    resource = resource.replace("{subscriptionId}", this.subscriptionId)
    resource = resource.replace("{resourceGroupName}", RESOURCE_GROUP_NAME)

    const req = await fetch(`https://management.azure.com${resource}`, {method: method, headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"}, body: body ? JSON.stringify(body) : null})
    const val = await req.json()
    return val.value || val
  }

  async doesResourceGroupExist() {
    const rgs = await this.azureRequest("GET", "/subscriptions/{subscriptionId}/resourcegroups?api-version=2016-09-01")
    return rgs.some((item) => item.name === RESOURCE_GROUP_NAME)
  }

  async azureWait(resource, checkTimes, checkInterval, checkCb) {
    for (let i = 0; i < checkTimes; i++) {
      const val = await this.azureRequest("GET", resource)
      if (checkCb(val))
        return val

      await new Promise(resolve => setTimeout(resolve, checkInterval))
    }

    throw new Error(`Timed out waiting for ${resource} to be completed.`)
  }

  getAzurePrettyError(errorObj) {
    let errorMessage = errorObj.message
    if (errorObj.details) {
      try {
        const jsonParsed = JSON.parse(errorObj.details[0].message)
        errorMessage += ` ${jsonParsed.error.message}`
      } catch (e) {
        errorMessage += ` ${errorObj.details[0].message}`
      }
    }
    return errorMessage
  }

  async createVM(adminPassword) {
    console.log(`Checking if resource group ${RESOURCE_GROUP_NAME} exists...`)
    if (!(await this.doesResourceGroupExist())) {
<<<<<<< HEAD
      console.log(`Creating the resource group...`)
      await this.azureRequest("PUT", "/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}?api-version=2016-09-01", {location: this.config.location})
    }

    // Create the vm
=======
      console.log(`Not found. Creating the resource group...`)
      await this.azureRequest("PUT", "/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}?api-version=2016-09-01", {location: this.config.location})
    }

    // create the vm
>>>>>>> parent of ddb0524... removed azure items from master, still available in azure branch
    console.log(`Creating ${RESOURCE_NAME_PREFIX} resources and vm...`)
    const parameters = {
      "location": {"value": this.config.location},
      "virtualMachineName": {"value": VM_NAME},
      "virtualMachineSize": {"value": "Standard_NV6"},
      "adminUsername": {"value": "cloudygamer"},
      "storageAccountName": {"value": `${RESOURCE_NAME_PREFIX}storage${(+new Date()).toString().slice(-4)}`},     // needs to be globally unique
      "virtualNetworkName": {"value": `${RESOURCE_NAME_PREFIX}vnet`},
      "networkInterfaceName": {"value": `${RESOURCE_NAME_PREFIX}if`},
      "networkSecurityGroupName": {"value": `${RESOURCE_NAME_PREFIX}nsg`},
      "adminPassword": {"value": adminPassword},
      "storageAccountType": {"value": "Standard_LRS"},
      "addressPrefix": {"value": "10.0.0.0/24"},
      "subnetName": {"value": "default"},
      "subnetPrefix": {"value": "10.0.0.0/24"},
      "publicIpAddressName": {"value": `${RESOURCE_NAME_PREFIX}ip`},
      "publicIpAddressType": {"value": "Dynamic"}
    }

    const template = await (await fetch("azuretemplate.json")).json()
    const body = {"properties": {"template": template, "mode": "Incremental", "parameters": parameters}}
    const deploymentName = "cloudygamerdeployer"
    const deployment = await this.azureRequest("PUT", `/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/providers/Microsoft.Resources/deployments/${deploymentName}?api-version=2016-09-01`, body)

    if (deployment && deployment.error)
      throw new Error(this.getAzurePrettyError(deployment.error))

<<<<<<< HEAD
    // Wait for deployment to complete (15 mins)
=======
    // wait for deployment to complete (15 mins)
>>>>>>> parent of ddb0524... removed azure items from master, still available in azure branch
    console.log("Waiting for deployment to complete...")
    const lastDepCheck = await this.azureWait(`${deployment.id}?api-version=2016-09-01`, 6 * 15, 10000, (val) => {
      return !["Running", "Accepted"].includes(val.properties.provisioningState)
    })

    if (lastDepCheck.properties.error)
      throw new Error(this.getAzurePrettyError(lastDepCheck.properties.error))
  }

  async runCommand(command) {
<<<<<<< HEAD
    // Use Extensions to run a command
    const vmExtensionName = "runcommand"
    const body = {
      location: "southcentralus",
      properties: {
        "publisher": "Microsoft.Compute",
        "type": "CustomScriptExtension",
        "typeHandlerVersion": "1.8",
        "autoUpgradeMinorVersion": true,
        "settings": {
          "commandToExecute": command
        }
      }
    }
    const extensionCreation = await this.azureRequest("PUT", `/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Compute/virtualMachines/${VM_NAME}/extensions/${vmExtensionName}?api-version=2016-03-30`, body)

    // Wait for a result from the command (15 mins)
    console.log("Waiting for command to complete...")
    const lastCheck = await this.azureWait(`${extensionCreation.id}?api-version=2016-03-30&$expand=instanceView`, 6 * 15, 1000, (val) => {
=======
    // use Extensions to run a command
    const vmExtensionName = "runcommand"
    const body = {
        location: "southcentralus",
        properties: {
            "publisher": "Microsoft.Compute",
            "type": "CustomScriptExtension",
            "typeHandlerVersion": "1.8",
            "autoUpgradeMinorVersion": true,
            "settings": {
                "commandToExecute": command
            }
        }
    }
    const extensionCreation = await this.azureRequest("PUT", `/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Compute/virtualMachines/${VM_NAME}/extensions/${vmExtensionName}?api-version=2016-03-30`, body)

    // wait for a result from the command (15 mins)
    console.log("Waiting for command to complete...")
    const lastCheck = await this.azureWait(`${extensionCreation.id}?api-version=2016-03-30`, 6 * 15, 1000, (val) => {
>>>>>>> parent of ddb0524... removed azure items from master, still available in azure branch
      return !["Creating"].includes(val.properties.provisioningState)
    })

    if (lastCheck.properties.error)
     throw new Error(this.getAzurePrettyError(lastCheck.properties.error))

<<<<<<< HEAD
    // Read the result
    //const result = await this.azureRequest("GET", `/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Compute/virtualMachines/${VM_NAME}?api-version=2016-03-30`)

    // GET /subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Compute/virtualMachines/{vmName}?api-version=2016-03-30[&$expand]

=======
>>>>>>> parent of ddb0524... removed azure items from master, still available in azure branch
    debugger

    // TODO: command still needs to be deleted after running (or reuse)
    // TODO: return result
  }

  async login() {
    this.adal.login()
  }

  async logout() {
    this.adal.logout()
  }

  async test() {
    console.log("test starting")
<<<<<<< HEAD
    //const res = await this.createVM("superSecret123Pass")
    const res = await this.runCommand("powershell 'ls c:/'")
=======
    const res = await this.runCommand("powershell 'sleep 10000 ; ls c:/'")
>>>>>>> parent of ddb0524... removed azure items from master, still available in azure branch
    console.log(`test done`)
  }
}