// python -m SimpleHTTPServer 8000

// TODO: support vpc machines too
// TODO: remove the requirement for us-west-2a
// TODO: validate that the volume is available
// TODO: respond to 1-minute-warning
// TODO: use a shared policy from my account (so everyone doesnt need it), maybe
//       security policy too

const ACCESS_KEY = "***REMOVED***"
const SECRET_ACCESS_KEY = "***REMOVED***"
const REGION = "us-west-2"
const AMI = "ami-861ddde6"
const SECURITY_GROUP = "sg-3a5edb09"
const EXTRA_DOLLARS = 0.10
const TOO_EXPENSIVE = 1.00
const CLOUDYGAMER_VOLUME = "vol-475df2ce"
const IAM_ROLE_NAME = "CloudyGamer_EC2_Role"
const FULFILLMENT_TIMEOUT_MINUTES = 5

class CloudyGamer {
  constructor() {
    AWS.config.update({accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_ACCESS_KEY})
    AWS.config.region = REGION

    this.ec2 = new AWS.EC2()
    this.ssm = new AWS.SSM()

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

  startInstance() {
    console.log("Looking for lowest price...")
    this.ec2.describeSpotPriceHistory({
      AvailabilityZone: "us-west-2a",     // remove this
      ProductDescriptions: ["Linux/UNIX"],  // 'Linux/UNIX (Amazon VPC)'],
      InstanceTypes: ["g2.2xlarge", "g2.8xlarge"],
      MaxResults: 100}).promise().
    then(data => {
      const zones = new Map()

      for (const price of data.SpotPriceHistory) {
        const key = `${price.AvailabilityZone}-${price.InstanceType}-${price.ProductDescription}`

        if (!zones.get(key)) {
          zones.set(key, price)
        }
      }

      const lowest = [...zones.entries()].reduce((prev, cur) =>
        parseFloat(cur.SpotPrice) <= parseFloat(prev.SpotPrice) ? cur : prev
      )[1]

      console.log(`Found a ${lowest.InstanceType} at $${lowest.SpotPrice} in ${lowest.AvailabilityZone} ${lowest.ProductDescription.includes("VPN") ? "(VPC)" : "(not VPC)"}`)

      if (Number(lowest.SpotPrice) >= TOO_EXPENSIVE) {
        throw new Error("Too expensive!")
      }

      return lowest

    }).
    then(lowest => {
      console.log("Requesting spot instance...")

      return this.ec2.requestSpotInstances({
        SpotPrice: (Number(lowest.SpotPrice) + EXTRA_DOLLARS).toString(),
        ValidUntil: new Date((new Date()).getTime() + (60000 * FULFILLMENT_TIMEOUT_MINUTES)),
        Type: "one-time",
        LaunchSpecification: {
          ImageId: AMI,
          SecurityGroupIds: [SECURITY_GROUP],
          InstanceType: lowest.InstanceType,
          Placement: {
            AvailabilityZone: lowest.AvailabilityZone
          },
          EbsOptimized: true,
          IamInstanceProfile: {
            Name: IAM_ROLE_NAME
          }
        }
      }).promise().
      then(data => {
        return data.SpotInstanceRequests[0].SpotInstanceRequestId
      })

    }).
    then(spotId => {
      console.log("Waiting for instance to be fulfilled...")

      AWS.apiLoader.services.ec2["2015-10-01"].waiters.SpotInstanceRequestFulfilled.delay = 10
      return this.ec2.waitFor("spotInstanceRequestFulfilled", {
        SpotInstanceRequestIds: [spotId]}).promise().
      then(data => {
        const instanceId = data.SpotInstanceRequests[0].InstanceId

        return this.getInstance(instanceId).then(instance => {
          console.log(`Instance fulfilled (${instance.InstanceId}, ${instance.PublicIpAddress}). Waiting for running state...`)

          AWS.apiLoader.services.ec2["2015-10-01"].waiters.InstanceRunning.delay = 2
          return this.ec2.waitFor("instanceRunning", {
            InstanceIds: [instanceId]}).promise().
          then(_ => {          // might be broke?
            return instanceId
          })
        })
      })

    }).
    then(instanceId => {
      console.log("Attaching cloudygamer volume...")

      return this.ec2.attachVolume({
        VolumeId: CLOUDYGAMER_VOLUME,
        InstanceId: instanceId,
        Device: "/dev/xvdb"}).promise().
      then(_ => {
        return this.ec2.waitFor("volumeInUse", {
          VolumeIds: [CLOUDYGAMER_VOLUME],
          Filters: [{
            Name: "attachment.status",
            Values: ["attached"]
          }]}).promise()

      }).
      then(_ => {
        console.log("Waiting for instance to come online...")
        return this.ssm.waitFor("InstanceOnline", {
          InstanceInformationFilterList: [{
            key: "InstanceIds",
            valueSet: [instanceId]
          }]}).promise()
      })

    }).then(_ => {
      console.log("Ready!")

    }).catch(err => {
      console.error(err)
    })
  }

  stopInstance() {
    console.log("Retrieving instance id...")
    return this.getInstance().then(instance => {
      const instanceId = instance.InstanceId

      console.log("Terminating instance...")
      return this.ec2.terminateInstances({
        InstanceIds: [instanceId]}).promise().
      then(_ => {

        console.log("Waiting for termination...")
        return this.ec2.waitFor("instanceTerminated", {
          InstanceIds: [instanceId]}).promise()
      })
    }).then(_ => {
      console.log("Done terminating!")
    })
  }

  isVolumeAvailable() {
    return this.ec2.describeVolumes({
      VolumeIds: [CLOUDYGAMER_VOLUME]}).promise().
    then(data => {
      return data.Volumes[0].State === "available"
    })
  }

  isInstanceOnline(instanceId) {
    return this.ssm.describeInstanceInformation({
      InstanceInformationFilterList: [{
        key: "InstanceIds",
        valueSet: [instanceId]
      }]}).promise().
    then(data => {
      return data.InstanceInformationList[0].PingStatus === "Online"
    })
  }

  getInstance(instanceId = null) {
    const params = instanceId ? {
      InstanceIds: [instanceId]
    } : {
      Filters: [{
        Name: "image-id",
        Values: [AMI]
      }, {
        Name: "instance-state-name",
        Values: ["pending", "running", "stopping"]
      }]
    }

    return this.ec2.describeInstances(params).promise().then(data => {
      if (data.Reservations.length > 0) {
        return data.Reservations[0].Instances[0]
      }

      return null
    })
  }
}
