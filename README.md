**CloudyGamer**: Stream GPU-intensive games in the cloud with your own AWS account. https://cloudygamer.com.

# Features

- Use your own AWS account, no other costs
- No server-side components (aside from AWS), so your credentials remain safe
- Automatic configuration of most AWS resources needed (VPC and Security Groups)
- Super simple one-click start/stop of EC2 GPU instances
- Uses Spot instances to save you money
- Keeps a persistent EBS hard drive available for 1-2 minute boot
- Designed around facilitating Steam In-Home Streaming to work over the internet (VPN still necessary)
- CloudyGamer is free and opensource!

# First time configuration

There are a variety of settings that you'll need to configure properly to get going. You'll of course need an AWS account.

In order to use CloudyGamer, you'll need to pick an *AWS Availability Zone*. The Zone is required since that's where EBS volumes are located. Pick your region based on [CloudPing](http://www.cloudping.info) and your zone based on looking at Spot pricing for g2.2xlarge instances.

We use a Linux AMI since it allows volumes to be attached at boot time (we hot attach the EBS Windows image). If we booted a Windows AMI, the boot up times are extremely slow as [Drive Initialization](http://docs.aws.amazon.com/AWSEC2/latest/WindowsGuide/ebs-initialize.html) needs to happen.

Instances can be either VPC or non-VPC. CloudyGamer automatically choses which one based on cost (Spot instance prices vary depending on this). This VPC is also created for you.

This service assumes you've done the instructions on the [Azure gaming article](http://lg.io/2016/10/12/cloudy-gamer-playing-overwatch-on-azures-new-monster-gpu-instances.html) except on EC2, OR you've used the slightly older [EC2 gaming article](http://lg.io/2015/07/05/revised-and-much-faster-run-your-own-highend-cloud-gaming-service-on-ec2.html) instructions. That's the EBS volume we'll be using.

- **awsAccessKey**: Create a new AWS user on your account with the inline policy [here](assets/user-policy.txt) (it'll change over time). The user should be password-less.
- **awsSecretAccessKey**: The secret access key for the user you created above. Remember that CloudyGamer logic is 100% local on your web browser. Even though you're at cloudygamer.com (or locally), this information is only stored on your browser and authenticated against AWS directly on your own account. In fact, cloudygamer.com is a simple Github Pages page.
- **awsIAMRoleName**: The Id of a new IAM Role you need to create that your EC2 instance will inherit. This is necessary for using AWS SSM to detect when the machine is online and to issue commands to it. Attach the policy `AmazonEC2RoleforSSM` to it.
- **awsRegionZone**: The zone in the region that has your EBS volume (ex. `us-west-1c`).
- **awsVolumeName**: Your Windows EBS volume's name (not ID) with Windows, your games, settings, etc

# Playing

1. Fill out the settings at the bottom of the page and save (uses Web Storage to keep them)
1. Click 'test/prep' and watch the browser Console for any errors
1. Click 'start instance', wait for it to be complete, and play
1. When you're done, click 'stop instance' to kill the EC2 instance (the volume stays though)

# Developing (hosting locally)

1. Start the server locally using `python -m SimpleHTTPServer 8000`
1. Go to http://127.0.0.1:8000

# Future

Ideally in the future we'll have support for:

- Multiple cloud providers (AWS, Azure, GCP, etc)
- No magic AMIs, auto-configuring machines from native cloud images

# Help?

Check out [https://www.reddit.com/r/cloudygamer/](https://www.reddit.com/r/cloudygamer/)