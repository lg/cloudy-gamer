// TODO: vnc not being installed with proper password

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

  async azureRequest(method, resource, body=null, parseJSON=true) {
    if (!this.adal.getCachedUser()) {
      throw new Error("Not logged into Azure")
    }

    // Load token if it's missing
    let token = this.adal.getCachedToken("https://management.azure.com/")
    if (!token) {
      console.log("Getting adal token...")
      token = await new Promise((resolve, reject) => {
        const adal = this.adal
        this.adal.acquireToken("https://management.azure.com/", (error, token) => {
          if (!error) {
            resolve(token)
          } else {
            if (error.includes("AADSTS50058")) {
              console.log("You seem logged out, logging back in...")
              adal.login()

              // TODO: needs to repeat the last call
            }
            reject(error)
          }
        })
      })
    }

    // Load subscription id if it's missing (and required for this call)
    if (resource.includes("{subscriptionId}") && !this.subscriptionId) {
      this.subscriptionId = (await this.azureRequest("GET", "/subscriptions?api-version=2014-04-01"))[0].subscriptionId
    }

    resource = resource.replace("{subscriptionId}", this.subscriptionId)
    resource = resource.replace("{resourceGroupName}", RESOURCE_GROUP_NAME)
    resource = resource.replace("{resourceGroup}", RESOURCE_GROUP_NAME)
    resource = resource.replace("{vm}", VM_NAME)

    const req = await fetch(`https://management.azure.com${resource}`, {method: method, headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"}, body: body ? JSON.stringify(body) : null})

    if (!parseJSON)
      return await req.text()

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
      console.log(`Creating the resource group...`)
      await this.azureRequest("PUT", "/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}?api-version=2016-09-01", {location: this.config.location})
    }

    // Create the vm
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

    // Wait for deployment to complete (15 mins)
    console.log("Waiting for deployment to complete...")
    const lastDepCheck = await this.azureWait(`${deployment.id}?api-version=2016-09-01`, 6 * 15, 10000, (val) => {
      return !["Running", "Accepted"].includes(val.properties.provisioningState)
    })

    if (lastDepCheck.properties.error)
      throw new Error(this.getAzurePrettyError(lastDepCheck.properties.error))
  }

  async runCommand(command) {
    // Use Extensions to run a command
    const vmExtensionName = `runcommand${Math.round(Math.random() * 10000)}`
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
    const lastCheck = await this.azureWait(`${extensionCreation.id}?api-version=2016-03-30&$expand=instanceView`, 50, 5000, (val) => {
      return !["Creating", "Updating"].includes(val.properties.provisioningState)
    })

    if (lastCheck.properties.error)
      throw new Error(this.getAzurePrettyError(lastCheck.properties.error))

    // Azure creates a new command extension
    await this.azureRequest("DELETE", `/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Compute/virtualMachines/${VM_NAME}/extensions/${vmExtensionName}?api-version=2016-03-30`, null, false)

    return lastCheck.properties.instanceView.substatuses[0].message || lastCheck.properties.instanceView.substatuses[1].message
  }

  async provision(userPassword) {
    // TODO: upload the powershell module instead of downloading it. currently we get a "command too long" error

    console.log("Downloading cloudygamer provision module and running it...")
    const command = `powershell -Command "New-Item -ItemType directory -Path $Env:ProgramFiles\\WindowsPowerShell\\Modules\\CloudyGamer -Force; (New-Object System.Net.WebClient).DownloadFile('http://cloudygamer.com/cloudygamer.psm1', \\\"$Env:ProgramFiles\\WindowsPowerShell\\Modules\\CloudyGamer\\cloudygamer.psm1\\\"); Import-Module CloudyGamer; New-CloudyGamerInstall -Password '${userPassword}'"`
    await this.runCommand(command)

    console.log("Installer started. This will take around 10-30 minutes. Status will be shown here roughly every minute.")
    let success = false
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 30000))

      const lastLine = await this.checkProvisionStatus()
      console.log(`Latest status: ${lastLine}`)
      if (lastLine.includes("All done!")) {
        success = true
        break
      }
    }

    if (success) {
      console.log(`Successfully provisioned the machine. NOTE: Instance is still running!`)
    } else {
      console.log(`Polled for ~30 minutes, image failed to be created in time. NOTE: Instance is still running!`)
    }
  }

  async checkProvisionStatus() {
    return await this.runCommand(`powershell -command "Get-Content 'c:\\cloudygamer\\installer.txt' -Tail 1"`)
  }

  async runningStatus() {
    const instance = await this.azureRequest("GET", `/subscriptions/{subscriptionId}/resourceGroups/{resourceGroup}/providers/Microsoft.Compute/virtualMachines/{vm}/InstanceView?api-version=2016-04-30-preview`)
    return instance.statuses.find((status) => {return status.code.startsWith("PowerState")}).code.substr(11)
  }

  async startInstance() {
    console.log("Starting instance...")
    await this.azureRequest("POST", `/subscriptions/{subscriptionId}/resourceGroups/{resourceGroup}/providers/Microsoft.Compute/virtualMachines/{vm}/start?api-version=2016-04-30-preview`, null, false)
  }

  async restartInstance() {
    console.log("Restarting instance...")
    await this.azureRequest("POST", `/subscriptions/{subscriptionId}/resourceGroups/{resourceGroup}/providers/Microsoft.Compute/virtualMachines/{vm}/restart?api-version=2016-04-30-preview`, null, false)
  }

  async stopInstance() {
    console.log("Deallocating instance...")
    await this.azureRequest("POST", `/subscriptions/{subscriptionId}/resourceGroups/{resourceGroup}/providers/Microsoft.Compute/virtualMachines/{vm}/deallocate?api-version=2016-04-30-preview`, null, false)
  }

  async login() {
    this.adal.login()
  }

  async logout() {
    this.adal.logout()
  }
}