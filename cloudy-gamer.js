// TODO: remove the requirement for us-west-2a
// TODO: validate that the volume is available
// TODO: respond to 1-minute-warning
// TODO: use a shared policy from my account (so everyone doesnt need it), maybe
//       security policy too
// TODO: figure out whats really needed for the security group
// TODO: do i REALLY need the subnet id when creating an instance
// TODO: upgrade to latest sdk (its broken right now)
// TODO: label all resources (including EC2 instance)

const EXTRA_DOLLARS = 0.10
const TOO_EXPENSIVE = 1.50
const FULFILLMENT_TIMEOUT_MINUTES = 5

class CloudyGamer {
  constructor(config) {
    this.config = config

    AWS.config.update({
      accessKeyId: this.config.awsAccessKey,
      secretAccessKey: this.config.awsSecretAccessKey,
      region: this.config.awsRegion
    })

    this.ec2 = new AWS.EC2()
    this.ssm = new AWS.SSM()

    this.securityGroupId = null
    this.vpcSecurityGroupId = null
    this.vpcSubnetId = null

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
      }
    }
  }

  async createVPCResources() {
    // TODO: consider classiclink?
    // TODO: make sure everything is labelled (the acls arent i think)
    // TODO: handle the 'unnecessary' lines below

    console.log("  Creating VPC...")
    const vpc = await this.ec2.createVpc({CidrBlock: "10.0.0.0/16", InstanceTenancy: "default"}).promise()

    console.log(`  Creating Subnet in ${this.config.awsRegionZone}...`)
    const subnet = await this.ec2.createSubnet({CidrBlock: "10.0.0.0/24", VpcId: vpc.Vpc.VpcId, AvailabilityZone: this.config.awsRegionZone}).promise()

    console.log("  Getting VPC's Route Table ID...")
    const routeTables = await this.ec2.describeRouteTables({Filters: [{Name: "vpc-id", Values: [vpc.Vpc.VpcId]}]}).promise()

    // TODO: maybe unnecessary?
    console.log("  Associating Route table to subnet...")
    await this.ec2.associateRouteTable({RouteTableId: routeTables.RouteTables[0].RouteTableId, SubnetId: subnet.Subnet.SubnetId}).promise()

    console.log("  Creating Internet Gateway...")
    const gateway = await this.ec2.createInternetGateway({}).promise()

    // TODO: maybe unnecessary?
    console.log("  Attaching Internet Gateway to VPC...")
    await this.ec2.attachInternetGateway({InternetGatewayId: gateway.InternetGateway.InternetGatewayId, VpcId: vpc.Vpc.VpcId}).promise()

    console.log("  Creating Route to Internet Gateway...")
    await this.ec2.createRoute({
      DestinationCidrBlock: "0.0.0.0/0",
      RouteTableId: routeTables.RouteTables[0].RouteTableId,
      GatewayId: gateway.InternetGateway.InternetGatewayId
    }).promise()

    console.log("  Creating VPC Security Group...")
    const securityGroup = await this.ec2.createSecurityGroup({GroupName: "cloudygamer", Description: "cloudygamer", VpcId: vpc.Vpc.VpcId}).promise()

    console.log("  Adding firewall rules to Security Group...")
    await this.ec2.authorizeSecurityGroupIngress({GroupId: securityGroup.GroupId, IpPermissions: [{IpProtocol: "-1", IpRanges: [{CidrIp: "0.0.0.0/0"}]}]}).promise()

    console.log("  Tagging all new resources...")
    await this.ec2.createTags({
      Resources: [vpc.Vpc.VpcId, subnet.Subnet.SubnetId, routeTables.RouteTables[0].RouteTableId, gateway.InternetGateway.InternetGatewayId, securityGroup.GroupId],
      Tags: [{Key: "Name", Value: "cloudygamervpc"}]}).promise()

    console.log("  Completed creating VPC.")

    return vpc.Vpc.VpcId
  }

  async createSecurityGroupResource() {
    console.log("  Creating non-VPC Security Group...")
    const securityGroup = await this.ec2.createSecurityGroup({GroupName: "cloudygamer", Description: "cloudygamer"}).promise()

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
    // TODO: check that ami exists and volume id exists
    // TODO: create IAM role too

    console.log("Checking for VPC resources...")
    const vpcs = await this.ec2.describeVpcs({Filters: [{Name: "tag:Name", Values: ["cloudygamervpc"]}]}).promise()
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
    const groups = await this.ec2.describeSecurityGroups({Filters: [{Name: "group-name", Values: ["cloudygamer"]}]}).promise()
    const vpcSecurityGroup = groups.SecurityGroups.find(group => group.VpcId && group.VpcId === vpcId)
    const securityGroup = groups.SecurityGroups.find(group => !group.VpcId)

    if (!vpcSecurityGroup) {
      throw new Error("Unable to find the VPC Security Group. For now, delete the cloudygamer VPC manually using the AWS Console (if it even exists) and retry.")
    }
    this.vpcSecurityGroupId = vpcSecurityGroup.GroupId
    this.securityGroupId = securityGroup ? securityGroup.GroupId : await this.createSecurityGroupResource()
  }

  async findLowestPrice() {
    const histories = []

    console.log("Looking for lowest price...")
    for (const product of ["Linux/UNIX", "Linux/UNIX (Amazon VPC)"]) {  /* 'Windows', 'Windows (Amazon VPC)' */
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

  async startInstance() {
    try {
      await this.discoverAndCreateResources()
      const lowest = await this.findLowestPrice()

      console.log("Requesting spot instance...")
      const isVPC = lowest.ProductDescription.includes("VPC")

      const spotRequest = await this.ec2.requestSpotInstances({
        SpotPrice: (Number(lowest.SpotPrice) + EXTRA_DOLLARS).toString(),
        ValidUntil: new Date((new Date()).getTime() + (60000 * FULFILLMENT_TIMEOUT_MINUTES)),
        Type: "one-time",
        LaunchSpecification: {
          ImageId: this.config.awsLinuxAMI,
          SecurityGroupIds: isVPC ? null : [this.securityGroupId],
          InstanceType: lowest.InstanceType,
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

      console.log("Waiting for instance to be fulfilled...")
      AWS.apiLoader.services.ec2["2015-10-01"].waiters.SpotInstanceRequestFulfilled.delay = 10
      const spotRequests = await this.ec2.waitFor("spotInstanceRequestFulfilled", {
        SpotInstanceRequestIds: [spotRequest.SpotInstanceRequests[0].SpotInstanceRequestId]}).promise()

      const instanceId = spotRequests.SpotInstanceRequests[0].InstanceId
      const instance = await this.getInstance(instanceId)

      console.log(`Instance fulfilled (${instance.InstanceId}, ${instance.PublicIpAddress}). Waiting for running state...`)
      AWS.apiLoader.services.ec2["2015-10-01"].waiters.InstanceRunning.delay = 2
      await this.ec2.waitFor("instanceRunning", {InstanceIds: [instanceId]}).promise()

      console.log("Attaching cloudygamer volume...")

      await this.ec2.attachVolume({
        VolumeId: this.config.awsVolumeId,
        InstanceId: instanceId,
        Device: "/dev/xvdb"}).promise()
      await this.ec2.waitFor("volumeInUse", {
        VolumeIds: [this.config.awsVolumeId],
        Filters: [{
          Name: "attachment.status",
          Values: ["attached"]
        }]}).promise()

      console.log("Waiting for instance to come online...")
      await this.ssm.waitFor("InstanceOnline", {
        InstanceInformationFilterList: [{
          key: "InstanceIds",
          valueSet: [instanceId]
        }]}).promise()

      console.log("Ready!")

    } catch (err) {
      console.error(err)
    }
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
    try {
      const instance = await this.getInstance()

      console.log("Sending restart command...")
      await this.ssm.sendCommand({
        DocumentName: "AWS-RunPowerShellScript",
        InstanceIds: [instance.InstanceId],
        Parameters: {
          commands: ["Start-ScheduledTask \"CloudyGamer Restart Steam\""]
        }}).promise()
      console.log("Steam restart command successfully sent")
    } catch (err) {
      console.error(err)
    }
  }

  async isVolumeAvailable() {
    const volumes = await this.ec2.describeVolumes({VolumeIds: [this.config.awsVolumeId]}).promise()
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
        {Name: "image-id", Values: [this.config.awsLinuxAMI]},
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
