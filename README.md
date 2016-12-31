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
- BETA: Script to auto-provision your EC2 images

# First time configuration

There are a variety of settings that you'll need to configure properly to get going. You'll of course need an AWS account.

In order to use CloudyGamer, you'll need to pick an *AWS Availability Zone*. The Zone is required since that's where EBS volumes are located. Pick your region based on [CloudPing](http://www.cloudping.info) and your zone based on looking at Spot pricing for g2.2xlarge instances.

We use a Linux AMI since it allows volumes to be attached at boot time (we hot attach the EBS Windows image). If we booted a Windows AMI, the boot up times are extremely slow as [Drive Initialization](http://docs.aws.amazon.com/AWSEC2/latest/WindowsGuide/ebs-initialize.html) needs to happen.

Instances can be either VPC or non-VPC. CloudyGamer automatically chooses which one based on cost (Spot instance prices vary depending on this). This VPC is also created for you.

This service assumes you've done the instructions on the [Azure gaming article](http://lg.io/2016/10/12/cloudy-gamer-playing-overwatch-on-azures-new-monster-gpu-instances.html) except on EC2, OR you've used the slightly older [EC2 gaming article](http://lg.io/2015/07/05/revised-and-much-faster-run-your-own-highend-cloud-gaming-service-on-ec2.html) instructions. That's the EBS volume we'll be using. Note: See the BETA section below for a script that can do this for you automatically.

- **awsAccessKey**: Create a new AWS user on your account with the inline policy [here](user-policy.txt) (it'll change over time). The user should be password-less.
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

# BETA: Automated CloudyGamer provisioning of machine

A beta feature right now is to not even manually set up the EC2 image (Azure hasn't been tested yet). Starting from the base Windows Server 2016 image from Amazon, running the `cloudygamer.psm1` script [here](cloudygamer.psm1) will set everything up for you. Use it this way:

1. Create a new Windows Server 2016 machine on EC2
1. Log in as Administrator using Microsoft Remotge Desktop
1. Open up the Windows PowerShell ISE, go to the File menu, select New, and paste the contents of `cloudygamer.psm1` into there
1. Save the file onto the Administrator's Desktop as `cloudygamer.psm1`
1. Open up a new Administrator PowerShell and run the following, replacing `<PASSWORD>` with a new password to set for the new user account

    ```
    New-Item -ItemType directory -Path "$Env:ProgramFiles\WindowsPowerShell\Modules\CloudyGamer" -Force
    Copy-Item "$Home\Desktop\cloudygamer.psm1" -Destination "$Env:ProgramFiles\WindowsPowerShell\Modules\CloudyGamer\" -Force

    Import-Module CloudyGamer
    New-CloudyGamerInstall -Password "<PASSWORD>"
    ```

This will create a new `cloudygamer` user on the machine, assign it administrator privileges, set up a startup script and then reboot. For the next 15-30 minutes, the machine will keep installing stuff and rebooting (read the [cloudygamer.psm1](cloudygamer.psm1) script for details). Going forward, always log into the machine as the `cloudygamer` user. To manually see the status look at the contents of the `c:\cloudygamer\installer.txt` file. You'll know the provisioning is complete when you see the status `All done!` and `Get-Job` returns `Completed`.

If there is a failure provisioning the machine, use the `Get-Job` PowerShell command to see the job IDs, and then use the `Receive-Job` command to see the output of all commands.

# Future

Ideally in the future we'll have support for:

- Multiple cloud providers (AWS, Azure, GCP, etc)
- No magic AMIs, auto-configuring machines from native cloud images **(working on it, see BETA above)**

# Help?

Check out [https://www.reddit.com/r/cloudygamer/](https://www.reddit.com/r/cloudygamer/)
