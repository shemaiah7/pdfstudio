# SentinelPDF desktop: one-time signing setup

Do these steps once so the Mac app is signed and notarized. Windows signing is optional; see "Windows code signing" below.

The desktop window loads the app at `https://sentinelpdf.com` (`APP_URL` in `desktop/src/config.ts`).
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
3. Tag the merge commit `desktop-vX.Y.Z` and push the tag. The tag must equal `desktop-v` plus the `desktop/package.json` version exactly, or the workflow stops before building.
4. The Desktop workflow creates a draft GitHub Release, builds on macOS and Windows and uploads into the draft. After both builds succeed it publishes the release automatically (if either build fails, the draft stays unpublished; delete it and the tag before retrying).
5. Open the new GitHub Release and check it has `SentinelPDF-mac.dmg`, `SentinelPDF-mac.zip`, `SentinelPDF-windows.exe`, `latest-mac.yml` and `latest.yml`.

## Owner access in the desktop app

Browsers can drop everything after `#` when they hand a `sentinelpdf://` link to an app, so open the link from Terminal instead. Copy the owner key from the Passwords app ("SentinelPDF owner key"), then run:

```bash
open "sentinelpdf://owner#$(pbpaste)"
```

SentinelPDF asks "Turn on owner access on this computer?"; choose **Turn on**. The key goes straight from the clipboard to the app and never appears on screen or in browser history. To turn owner access off, run `open "sentinelpdf://owner#"` and choose **Turn off**.

Check it worked: open a PDF and run one AI request; the AI panel's footer reads "Owner · unlimited".

## Windows code signing (Azure Artifact Signing)

Until this is switched on, the Windows installer is unsigned and SmartScreen shows "Windows protected your PC".

Already set up (October 2026):
- Azure subscription "SentinelPDF Signing", resource group and Artifact Signing account `sentinelpdf-signing` (Basic, East US, endpoint `https://eus.codesigning.azure.net/`).
- Organization identity validation for Melantech Innovations L.L.C. (ID `c3d96706-a437-471f-b4ca-66b4d2712ae9`).
- App registration `sentinelpdf-github-signing` with the "Artifact Signing Certificate Profile Signer" role on the account. Its client secret expires 2028-10-16; make a new one before then and replace the GitHub secret.
- GitHub secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`.

To switch it on, after the identity validation shows **Completed**:
1. On the signing account, open Certificate profiles → Create → **Public Trust**, name it `SentinelPDF`, and pick the completed validation.
2. Open the profile and note the certificate's subject **CN** exactly as shown.
3. In GitHub → Settings → Secrets and variables → Actions → **Variables**, add `AZURE_SIGNING_PROFILE` = `SentinelPDF` and `AZURE_PUBLISHER_NAME` = that CN.
4. Release as usual. The Windows job signs the installer and fails if the signature isn't valid or the signer name doesn't match `AZURE_PUBLISHER_NAME`.

`AZURE_PUBLISHER_NAME` must never change afterwards without care: installed apps check that later updates are signed by that name.
