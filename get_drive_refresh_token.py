#!/usr/bin/env python3
"""
One-time helper: authorize this tool to upload to YOUR Google Drive (not a
service account), and print the values to save as GitHub repository
secrets.

Run this once, locally (e.g. in Termux), after creating an OAuth "Desktop
app" client in Google Cloud Console and downloading its client secret JSON.

Usage:
    pip install google-auth-oauthlib
    python get_drive_refresh_token.py --client-secrets client_secret.json

It starts a local server and prints a URL - open that URL in your browser
on the same device, sign in, and approve access. The refresh token is
then printed here.
"""
import argparse

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/drive.file"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client-secrets", required=True, help="OAuth Desktop client JSON")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()

    flow = InstalledAppFlow.from_client_secrets_file(args.client_secrets, SCOPES)
    creds = flow.run_local_server(port=args.port, open_browser=False)

    print("\n=== Save these as GitHub repository secrets ===")
    print(f"GDRIVE_CLIENT_ID={creds.client_id}")
    print(f"GDRIVE_CLIENT_SECRET={creds.client_secret}")
    print(f"GDRIVE_REFRESH_TOKEN={creds.refresh_token}")


if __name__ == "__main__":
    main()
