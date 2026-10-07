# Security policy

## Reporting a vulnerability

Please report security issues privately, not in a public issue or pull request.
Use GitHub's private vulnerability reporting: on
[jhoffman-dev/atlas](https://github.com/jhoffman-dev/atlas), open the **Security** tab
and choose **Report a vulnerability**.

Include what you found, how to reproduce it, and what it lets an attacker do. You will
get an acknowledgement, and a fix or a decision will be shared in the advisory before
anything is made public.

## Supported versions

Only the latest `main` is supported. Atlas is a local-first desktop app with no hosted
service, so reports about the app itself, its local HTTP/MCP API, the sync path and the
handling of stored secrets are all in scope.
