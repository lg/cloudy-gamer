*CloudyGamer*: A self-run web service to play games using EC2

# Playing

1. Go to https://lg.github.io/cloudy-gamer
1. Fill out the settings at the bottom of the page and save (uses Web Storage to keep them)
1. Click 'start instance', wait for it to be complete, and play
1. When you're done click 'stop instance' to kill the EC2 instance (the volume stays though)

# Developing (hosting locally)

1. Start the server locally using `python -m SimpleHTTPServer 8000`
1. Go to http://127.0.0.1:8000

# Future

Ideally in the future we'll have support for:

- Auto-detect missing settings and create them on the cloud provider
- Multiple cloud providers (EC2, AWS, GCP, etc)
- No magic AMIs, auto-configuring machines from native cloud images

# Help?

Check out [https://www.reddit.com/r/cloudygamer/](https://www.reddit.com/r/cloudygamer/)