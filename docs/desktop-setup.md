# SentinelPDF desktop: one-time signing setup

Do these steps once so the Mac app is signed and notarized. Windows needs nothing.
Never paste any of these values into chat. Enter them only on the pages named below.

1. **Accept Apple's latest agreement.** Go to developer.apple.com, click Account, and accept the updated Apple Developer Program License Agreement if a banner shows. Notarization fails until it is accepted.
2. **Create a Developer ID Application certificate.**
   1. Open Keychain Access, then the menu Keychain Access, Certificate Assistant, Request a Certificate From a Certificate Authority.
   2. Enter your email and name, choose "Saved to disk", and save the request file.
   3. On developer.apple.com, go to Account, Certificates, click the + button, choose Developer ID Application (G2 Sub-CA), and upload the request file.
   4. Download the `.cer` file and double-click it to add it to Keychain Access.
3. **Export it.** In Keychain Access, open My Certificates, find "Developer ID Application: ...", right-click, Export, choose the `.p12` format, and set a strong password. Remember this password; it becomes `MAC_CERT_PASSWORD`.
4. **Base64 the file.** In Terminal, run `base64 -i DeveloperID.p12 | pbcopy` (use the real file name). The result is now on your clipboard.
5. **Make an app-specific password.** Go to account.apple.com, Sign-In and Security, App-Specific Passwords, and generate one named "SentinelPDF notarization". Copy it.
6. **Find your Team ID.** On developer.apple.com, go to Account, Membership details, and copy the Team ID.
7. **Add five GitHub secrets.** Go to GitHub, shemaiah7/pdfstudio, Settings, Secrets and variables, Actions, New repository secret. Create each of these:
   - `MAC_CERT_P12_BASE64`: the base64 text from step 4
   - `MAC_CERT_PASSWORD`: the `.p12` password from step 3
   - `APPLE_ID`: your Apple ID email
   - `APPLE_APP_SPECIFIC_PASSWORD`: the password from step 5
   - `APPLE_TEAM_ID`: the Team ID from step 6
8. **Tell Claude "secrets are in".** Claude then tags `desktop-v1.0.0`, which starts the release build.
9. **Clean up.** Delete the local `.p12` file and the certificate request (CSR) file.

## Releasing a new desktop version

1. Bump `version` in `desktop/package.json`.
2. Merge that change to `main`.
3. Tag the merge commit `desktop-vX.Y.Z` (matching the version) and push the tag.
4. Wait for the Desktop workflow to finish on both macOS and Windows.
5. Open the new GitHub Release and check it has `SentinelPDF-mac.dmg`, `SentinelPDF-mac.zip`, `SentinelPDF-windows.exe`, `latest-mac.yml` and `latest.yml`.
