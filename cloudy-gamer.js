// TODO: remove the requirement for us-west-2a
// TODO: validate that the volume is available
// TODO: respond to 1-minute-warning
// TODO: use a shared policy from my account (so everyone doesnt need it), maybe
//       security policy too

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

  async ensureResourcesExist() {
    console.log("Ensuring resources (security groups) exist...")

    const groups = await this.ec2.describeSecurityGroups({Filters: [{Name: "group-name", Values: ["cloudygamer"]}]}).promise()
    const vpcSecurityGroup = groups.SecurityGroups.find(group => group.VpcId)
    const securityGroup = groups.SecurityGroups.find(group => !group.VpcId)

    if (securityGroup) {
      this.securityGroupId = securityGroup.GroupId
    } else {
      console.log("Creating non-VPC security group...")
      const newSecurityGroup = await this.ec2.createSecurityGroup({GroupName: "cloudygamer", Description: "cloudygamer"}).promise()
      this.securityGroupId = newSecurityGroup.GroupId
      await this.ec2.authorizeSecurityGroupIngress({
        GroupId: newSecurityGroup.GroupId,
        IpPermissions: [
          {FromPort: 0, IpProtocol: "tcp", IpRanges: [{CidrIp: "0.0.0.0/0"}], ToPort: 65535},
          {FromPort: 0, IpProtocol: "udp", IpRanges: [{CidrIp: "0.0.0.0/0"}], ToPort: 65535},
          {FromPort: -1, IpProtocol: "icmp", IpRanges: [{CidrIp: "0.0.0.0/0"}], ToPort: -1}
        ]
      }).promise()
    }

    if (vpcSecurityGroup) {
      this.vpcSecurityGroupId = vpcSecurityGroup.GroupId
    } else {
      console.log("Creating VPC security group...")
      const newSecurityGroup = await this.ec2.createSecurityGroup({
        GroupName: "cloudygamer", Description: "cloudygamer", VpcId: this.config.awsVPCId
      }).promise()
      this.vpcSecurityGroupId = newSecurityGroup.GroupId
      await this.ec2.authorizeSecurityGroupIngress({
        GroupId: newSecurityGroup.GroupId,
        IpPermissions: [{IpProtocol: "-1", IpRanges: [{CidrIp: "0.0.0.0/0"}]}]
      }).promise()
    }
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
      await this.ensureResourcesExist()
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
            SubnetId: this.config.awsSubnetVPCId,
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
    return data.InstanceInformationList[0].PingStatus === "Online"
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
