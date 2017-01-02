const EXTRA_DOLLARS = 0.10
const TOO_EXPENSIVE = 1.50
const FULFILLMENT_TIMEOUT_MINUTES = 5
const VPC_NAME = "cloudygamervpc"
const SECURITY_GROUP_NAME = "cloudygamer"
const BOOT_AMI_NAME = "cloudygamer-loader5"
const BOOT_AMI_OWNER = "255191696678"

class CloudyGamer {
  constructor(config) {
    this.config = config

    this.awsRegion = this.config.awsRegionZone.slice(0, -1)

    AWS.config.update({
      accessKeyId: this.config.awsAccessKey,
      secretAccessKey: this.config.awsSecretAccessKey,
      region: this.awsRegion
    })

    this.ec2 = new AWS.EC2()
    this.ssm = new AWS.SSM()

    this.securityGroupId = null
    this.vpcSecurityGroupId = null
    this.vpcSubnetId = null
    this.bootAMI = null

    this.ssm.api.waiters = {
      InstanceOnline: {
        name: "InstanceOnline",
        acceptors: [{
          argument: "InstanceInformationList[].PingStatus",
          expected: "Online",
          matcher: "pathAll",
          state: "success"
        }],
        delay: 5,
        maxAttempts: 80,
        operation: "describeInstanceInformation"
      },
      CommandInvoked: {
        name: "CommandInvoked",
        acceptors: [{
          argument: "CommandInvocations[].Status",
          expected: "Success",
          matcher: "pathAll",
          state: "success"
        }, {
          argument: "CommandInvocations[].Status",
          expected: "Failed",
          matcher: "pathAll",
          state: "failure"
        }],
        delay: 5,
        maxAttempts: 80,
        operation: "listCommandInvocations"
      }
    }
  }

  async createVPCResources() {
    console.log("  Creating VPC...")
    const vpc = await this.ec2.createVpc({CidrBlock: "10.0.0.0/16", InstanceTenancy: "default"}).promise()

    console.log(`  Creating Subnet in ${this.config.awsRegionZone}...`)
    const subnet = await this.ec2.createSubnet({CidrBlock: "10.0.0.0/24", VpcId: vpc.Vpc.VpcId, AvailabilityZone: this.config.awsRegionZone}).promise()

    console.log("  Getting VPC's Route Table ID...")
    const routeTables = await this.ec2.describeRouteTables({Filters: [{Name: "vpc-id", Values: [vpc.Vpc.VpcId]}]}).promise()

    console.log("  Associating Route table to subnet...")
    await this.ec2.associateRouteTable({RouteTableId: routeTables.RouteTables[0].RouteTableId, SubnetId: subnet.Subnet.SubnetId}).promise()

    console.log("  Creating Internet Gateway...")
    const gateway = await this.ec2.createInternetGateway({}).promise()

    console.log("  Attaching Internet Gateway to VPC...")
    await this.ec2.attachInternetGateway({InternetGatewayId: gateway.InternetGateway.InternetGatewayId, VpcId: vpc.Vpc.VpcId}).promise()

    console.log("  Creating Route to Internet Gateway...")
    await this.ec2.createRoute({
      DestinationCidrBlock: "0.0.0.0/0",
      RouteTableId: routeTables.RouteTables[0].RouteTableId,
      GatewayId: gateway.InternetGateway.InternetGatewayId
    }).promise()

    console.log("  Finding the ACLs...")
    const acls = await this.ec2.describeNetworkAcls({Filters: [{Name: "vpc-id", Values: [vpc.Vpc.VpcId]}]}).promise()

    console.log("  Creating VPC Security Group...")
    const securityGroup = await this.ec2.createSecurityGroup({GroupName: SECURITY_GROUP_NAME, Description: "cloudygamer", VpcId: vpc.Vpc.VpcId}).promise()

    console.log("  Adding firewall rules to Security Group...")
    await this.ec2.authorizeSecurityGroupIngress({GroupId: securityGroup.GroupId, IpPermissions: [{IpProtocol: "-1", IpRanges: [{CidrIp: "0.0.0.0/0"}]}]}).promise()

    console.log("  Tagging all new resources...")
    await this.ec2.createTags({
      Resources: [vpc.Vpc.VpcId, subnet.Subnet.SubnetId, routeTables.RouteTables[0].RouteTableId, gateway.InternetGateway.InternetGatewayId, securityGroup.GroupId, acls.NetworkAcls[0].NetworkAclId],
      Tags: [{Key: "Name", Value: VPC_NAME}]}).promise()

    console.log("  Completed creating VPC.")

    return vpc.Vpc.VpcId
  }

  async createSecurityGroupResource() {
    console.log("  Creating non-VPC Security Group...")
    const securityGroup = await this.ec2.createSecurityGroup({GroupName: SECURITY_GROUP_NAME, Description: "cloudygamer"}).promise()

    console.log("  Adding firewall rules to Security Group...")
    await this.ec2.authorizeSecurityGroupIngress({
      GroupId: securityGroup.GroupId,
      IpPermissions: [
        {FromPort: 0, IpProtocol: "tcp", IpRanges: [{CidrIp: "0.0.0.0/0"}], ToPort: 65535},
        {FromPort: 0, IpProtocol: "udp", IpRanges: [{CidrIp: "0.0.0.0/0"}], ToPort: 65535},
        {FromPort: -1, IpProtocol: "icmp", IpRanges: [{CidrIp: "0.0.0.0/0"}], ToPort: -1}
      ]
    }).promise()

    console.log("  Completed created non-VPC Security Group.")

    return securityGroup.GroupId
  }

  async discoverAndCreateResources() {
    console.log("Looking for boot AMI...")
    const images = await this.ec2.describeImages({Filters: [{Name: "name", Values: [BOOT_AMI_NAME]}, {Name: "owner-id", Values: [BOOT_AMI_OWNER]}]}).promise()
    if (images.Images.length === 0) {
      throw new Error(`Unable to find AMI ${BOOT_AMI_NAME} by owner ${BOOT_AMI_OWNER} in region ${this.awsRegion}. It's likely this region doesn't have have g2.2xlarge machines. Pick another region.`)
    }
    this.bootAMI = images.Images[0].ImageId

    console.log("Checking for VPC resources...")
    const vpcs = await this.ec2.describeVpcs({Filters: [{Name: "tag:Name", Values: [VPC_NAME]}]}).promise()
    const vpcId = vpcs.Vpcs.length > 0 ? vpcs.Vpcs[0].VpcId : await this.createVPCResources()

    console.log(`Retrieving VPC Subnet ID for ${this.config.awsRegionZone}...`)
    const subnets = await this.ec2.describeSubnets({Filters: [
      {Name: "vpc-id", Values: [vpcId]},
      {Name: "availabilityZone", Values: [this.config.awsRegionZone]}]}).promise()
    if (subnets.Subnets.length === 0) {
      throw new Error("VPC exists, but there's no subnet in this availability zone. For now, delete the VPC manually using the AWS Console and retry (your VPC will be put in this new zone).")
    }
    this.vpcSubnetId = subnets.Subnets[0].SubnetId

    console.log("Retrieving VPC and non-VPC Security Groups...")
    const groups = await this.ec2.describeSecurityGroups({Filters: [{Name: "group-name", Values: [SECURITY_GROUP_NAME]}]}).promise()
    const vpcSecurityGroup = groups.SecurityGroups.find(group => group.VpcId && group.VpcId === vpcId)
    const securityGroup = groups.SecurityGroups.find(group => !group.VpcId)

    if (!vpcSecurityGroup) {
      throw new Error("Unable to find the VPC Security Group. For now, delete the cloudygamer VPC manually using the AWS Console (if it even exists) and retry.")
    }
    this.vpcSecurityGroupId = vpcSecurityGroup.GroupId
    this.securityGroupId = securityGroup ? securityGroup.GroupId : await this.createSecurityGroupResource()
    console.log("Seems good!")
  }

  async findLowestPrice(instanceTypes) {
    const histories = []

    console.log("Looking for lowest price...")
    for (const product of instanceTypes) {
      const data = await this.ec2.describeSpotPriceHistory({
        AvailabilityZone: this.config.awsRegionZone,
        ProductDescriptions: [product],
        InstanceTypes: ["g2.2xlarge"],     /* "g2.8xlarge" */
        MaxResults: 100
      }).promise()
      histories.push(...data.SpotPriceHistory)
    }

    const zones = new Map()
    let lowest = histories[0]

    for (const price of histories) {
      const key = `${price.AvailabilityZone}-${price.InstanceType}-${price.ProductDescription}`

      if (!zones.get(key) || price.Timestamp > zones.get(key).Timestamp) {
        zones.set(key, price)
        if (parseFloat(price.SpotPrice) <= parseFloat(lowest.SpotPrice)) {
          lowest = price
        }
      }
    }

    console.log(`Found a ${lowest.InstanceType} on ${lowest.ProductDescription} at $${lowest.SpotPrice} in ${lowest.AvailabilityZone}`)

    if (Number(lowest.SpotPrice) >= TOO_EXPENSIVE) {
      throw new Error("Too expensive!")
    }

    return lowest
  }

  async startSpotInstance(instanceTypes, amiId, attachVolumeId, keepEBSVolume) {
    await this.discoverAndCreateResources()
    const lowest = await this.findLowestPrice(instanceTypes)
    amiId = amiId || this.bootAMI

    let blockDeviceMappings = null
    if (keepEBSVolume) {
      console.log("Getting AMI details for EBS details...")
      const image = await this.ec2.describeImages({ImageIds: [amiId]}).promise()
      blockDeviceMappings = image.Images[0].BlockDeviceMappings
      blockDeviceMappings[0].Ebs.DeleteOnTermination = false
    }

    console.log("Requesting spot instance...")
    const isVPC = lowest.ProductDescription.includes("VPC")
    const spotRequest = await this.ec2.requestSpotInstances({
      SpotPrice: (Number(lowest.SpotPrice) + EXTRA_DOLLARS).toString(),
      ValidUntil: new Date((new Date()).getTime() + (60000 * FULFILLMENT_TIMEOUT_MINUTES)),
      Type: "one-time",
      LaunchSpecification: {
        ImageId: amiId,
        SecurityGroupIds: isVPC ? null : [this.securityGroupId],
        InstanceType: lowest.InstanceType,
        BlockDeviceMappings: blockDeviceMappings,
        Placement: {
          AvailabilityZone: lowest.AvailabilityZone
        },
        EbsOptimized: lowest.InstanceType === "g2.2xlarge" ? true : null,
        NetworkInterfaces: isVPC ? [{
          DeviceIndex: 0,
          SubnetId: this.vpcSubnetId,
          AssociatePublicIpAddress: true,
          Groups: [this.vpcSecurityGroupId]
        }] : null,
        IamInstanceProfile: {
          Name: this.config.awsIAMRoleName
        }
      }
    }).promise()
    const spotRequestId = spotRequest.SpotInstanceRequests[0].SpotInstanceRequestId

    console.log("Waiting for instance to be fulfilled...")
    this.ec2.api.waiters.spotInstanceRequestFulfilled.delay = 10
    const spotRequests = await this.ec2.waitFor("spotInstanceRequestFulfilled", {
      SpotInstanceRequestIds: [spotRequestId]}).promise()

    const instanceId = spotRequests.SpotInstanceRequests[0].InstanceId
    const instance = await this.getInstance(instanceId)

    console.log(`Instance fulfilled (${instance.InstanceId}, ${instance.PublicIpAddress}). Tagging it...`)
    await this.ec2.createTags({Resources: [instanceId, spotRequestId], Tags: [{Key: "Name", Value: "cloudygamer"}]}).promise()

    if (attachVolumeId) {
      console.log("Waiting for running state...")
      this.ec2.api.waiters.instanceRunning.delay = 2
      await this.ec2.waitFor("instanceRunning", {InstanceIds: [instanceId]}).promise()

      console.log("Attaching cloudygamer volume...")
      await this.ec2.attachVolume({
        VolumeId: attachVolumeId,
        InstanceId: instanceId,
        Device: "/dev/xvdb"}).promise()
      await this.ec2.waitFor("volumeInUse", {
        VolumeIds: [attachVolumeId],
        Filters: [{
          Name: "attachment.status",
          Values: ["attached"]
        }]}).promise()
    }

    console.log("Waiting for instance to come online...")
    await this.ssm.waitFor("InstanceOnline", {
      InstanceInformationFilterList: [{
        key: "InstanceIds",
        valueSet: [instanceId]
      }]}).promise()

    return instanceId
  }

  async startInstance() {
    await this.startSpotInstance(["Linux/UNIX", "Linux/UNIX (Amazon VPC)"], null, this.config.awsVolumeId, false)
    console.log("Ready!")
  }

  async provisionNewImage(userPassword) {
    if (!userPassword)
      throw new Error("You must specify a password for the cloudygamer user")

    console.log("Finding latest Windows Server 2016 AMI...")
    const images = await this.ec2.describeImages({Filters: [
      {Name: "description", Values: ["Microsoft Windows Server 2016 with Desktop Experience Locale English AMI provided by Amazon"]}
    ]}).promise()
    const newestAMI = images.Images.sort((a, b) => { return new Date(a.CreationDate) < new Date(b.CreationDate) })[0]

    const instanceId = await this.startSpotInstance(["Windows", "Windows (Amazon VPC)"], newestAMI.ImageId, null, true)

    console.log("Getting script...")
    const scriptB64 = btoa(await (await fetch("cloudygamer.psm1")).text())

    console.log("Starting CloudyGamer Installer...")
    await this.ssm.sendCommand({
      DocumentName: "AWS-RunPowerShellScript",
      InstanceIds: [instanceId],
      Parameters: {
        commands: [`New-Item -ItemType directory -Path "$Env:ProgramFiles\\WindowsPowerShell\\Modules\\CloudyGamer" -Force; [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String("${scriptB64}")) | Out-File "$Env:ProgramFiles\\WindowsPowerShell\\Modules\\CloudyGamer\\cloudygamer.psm1"; Import-Module CloudyGamer; New-CloudyGamerInstall -Password "${userPassword}"`]
      }}).promise()
    console.log("Started.")
  }

  async checkProvisionStatus() {
    console.log("Retrieving instance id...")
    const instanceId = (await this.getInstance()).InstanceId

    console.log("Getting provision status...")
    const command = await this.ssm.sendCommand({
      DocumentName: "AWS-RunPowerShellScript",
      InstanceIds: [instanceId],
      Parameters: {
        commands: [`Get-Content "c:\\cloudygamer\\installer.txt"`]
      }}).promise()
    const commandId = command.Command.CommandId

    console.log("Waiting for provision status result...")
    const result = await this.ssm.waitFor("CommandInvoked", {
      CommandId: commandId,
      InstanceId: instanceId,
      Details: true
    }).promise()
    const outputLines = result.CommandInvocations[0].CommandPlugins[0].Output.split("\n")
    const lastLine = outputLines[outputLines.length - 2]

    console.log(`Latest status is: ${lastLine}`)
  }

  async stopInstance() {
    console.log("Retrieving instance id...")
    const instanceId = (await this.getInstance()).InstanceId

    console.log("Terminating instance...")
    await this.ec2.terminateInstances({InstanceIds: [instanceId]}).promise()

    console.log("Waiting for termination...")
    await this.ec2.waitFor("instanceTerminated", {InstanceIds: [instanceId]}).promise()

    console.log("Done terminating!")
  }

  async restartSteam() {
    const instance = await this.getInstance()

    console.log("Sending restart command...")
    await this.ssm.sendCommand({
      DocumentName: "AWS-RunPowerShellScript",
      InstanceIds: [instance.InstanceId],
      Parameters: {
        commands: ["Start-ScheduledTask \"CloudyGamer Restart Steam\""]
      }}).promise()
    console.log("Steam restart command successfully sent")
  }

  async isVolumeAvailable() {
    const volumes = await this.ec2.describeVolumes({Filters: [{Name: "volume-id", Values: [this.config.awsVolumeId]}]}).promise()
    return volumes.Volumes[0].State === "available"
  }

  async isInstanceOnline(instanceId) {
    const data = await this.ssm.describeInstanceInformation({
      InstanceInformationFilterList: [{
        key: "InstanceIds",
        valueSet: [instanceId]
      }]}).promise()
    return data.InstanceInformationList.length === 1 && data.InstanceInformationList[0].PingStatus === "Online"
  }

  async getInstance(instanceId = null) {
    const instanceParams = instanceId ? {
      InstanceIds: [instanceId]
    } : {
      Filters: [
        {Name: "tag:Name", Values: ["cloudygamer"]},
        {Name: "instance-state-name", Values: ["pending", "running", "stopping"]}
      ]
    }

    const data = await this.ec2.describeInstances(instanceParams).promise()
    if (data.Reservations.length > 0) {
      return data.Reservations[0].Instances[0]
    }

    throw new Error("cloudygamer instance not found")
  }
}
