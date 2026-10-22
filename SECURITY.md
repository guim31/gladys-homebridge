# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes. The
integration stores nothing in `/data`: its configuration (the address of the
Homebridge UI, the user name and password) is kept by Gladys and given to the
container at start-up; the session token of the UI lives in memory only. It
only talks to the Homebridge UI configured, on the local network, over HTTP or
HTTPS and WebSocket; the password and the token are never written to the logs,
and an address holding credentials is refused. Locks, garage doors and alarms
cannot be commanded unless the user allows each family.

Homebridge must run in insecure mode for the UI to reach the accessories: any
program on the network knowing the PIN of a bridge can then control it. This
is a choice of the Homebridge user, documented in `docs/`.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and Homebridge, its plugins and the devices they talk to.
