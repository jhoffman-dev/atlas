## Installing

This build is not signed by an Apple Developer ID yet, so macOS will not open
it the first time. Download the `.dmg`, drag {app} to Applications, then either:

- **System Settings → Privacy & Security**, scroll to the message about {app},
  and choose **Open Anyway** (on macOS 14 and earlier, right-click {app} in
  Applications and choose **Open** instead), or
- in Terminal: `xattr -dr com.apple.quarantine "/Applications/{app}.app"`

Apple silicon Macs only.
