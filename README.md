# Screeps Steamless Client

## About
This package surfaces the [Screeps](https://screeps.com/) client in the browser of your choice for
users who have purchased the [official Screeps
app](https://store.steampowered.com/app/464350/Screeps/) on Steam.

I personally run into a lot of issues with the official client, especially on macOS. The official
client is simply an [NW.js](https://nwjs.io/) wrapper around an [AngularJS](https://angularjs.org/)
app. The version of NW.js included with the client is fairly ancient; at the time of this writing it
was based on Chrome 76 [July 2019] -- a two year old version. I made this package because I was
experiencing frequent crashes in the official client, and I desired a native experience on my Apple
M1-based computer.

This client just serves up the Screeps client files which are already sitting in your Steam folder.
It also adds some basic endpoints for authentication via Steam OpenID. For all intents and purposes
it is the official client but running in the browser of your choice.


## Installation & Use
```
npm install -g screeps-steamless-client
npx screeps-steamless-client
```

You must visit a specially crafted local URL in order to specify the server you want to connect to.
In order to connect to the official Screeps World server you would visit:
http://localhost:8080/(https://screeps.com)/.

In order to visit a local server running on port 21025 you would visit:
http://localhost:8080/(http://localhost:21025)/. Note that Steam OpenId support is required on your
local server which can be enabled with
[screepsmod-auth](https://github.com/ScreepsMods/screepsmod-auth). For xxscreeps servers this should
be enabled by default.

The final "/" at the end of the URI is important - you'll receive an error if you omit it.

### Locating Screeps World client

This package require Screeps World to be installed. The package attempts to locate the game files automatically, but if it cannot be done, then you must provide the location of the file with the "--package" argument. For example:

`npx screepers-steamless-client --package ~/Screeps/package.nw`

### Configuring host interface and port

By default the package listens for connections on localhost (127.0.0.1) and on port 8080. These can be changed with the `--host` and `--port` parameters respectively. If you are running the steamless client on the same machine as your browser, these default settings might be fine. However if you run the client on the same host as the screeps private server, then you may need to ensure that the package listens on the correct outward-facing network interface, rather than localhost. If you want the client to listen on all interfaces on Linux, then you can use 0.0.0.0 as the host. For example:

`npx screepers-steamless-client --host 0.0.0.0`

## Tips
This client makes use of "guest mode" which is enabled by default in
[xxscreeps](https://github.com/laverdet/xxscreeps/). This will provide you with a read-only view of
the server when you are not signed in. The client will show you as signed in as user Guest and your
icon will belong to the Invader user. To sign in with your Steam account you need to select "Sign
Out" first, which will sign you out of Guest and bring you to the real login page. Click the Steam
icon towards the bottom to sign-in with your Steam account and play the game as normal.

![Safari Example](./docs/safari.png)
