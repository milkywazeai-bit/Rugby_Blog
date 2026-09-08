#!/usr/bin/env python3
"""
Upload newly crawled posts to a Google Drive folder, so NotebookLM (linked
to that folder as a source) can pick them up.

Only uploads files that aren't already in the Drive folder (by filename) -
existing files are left untouched, since a post's content doesn't change
after it's been crawled once.

Usage:
    python sync_to_drive.py --key-file service-account.json \
        --folder-id <drive-folder-id> --source posts
"""
import argparse
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

SCOPES = ["https://www.googleapis.com/auth/drive"]


def get_service(key_path: str):
    creds = service_account.Credentials.from_service_account_file(key_path, scopes=SCOPES)
    return build("drive", "v3", credentials=creds)


def list_existing_filenames(service, folder_id: str) -> set:
    names = set()
    page_token = None
    while True:
        resp = service.files().list(
            q=f"'{folder_id}' in parents and trashed = false",
            fields="nextPageToken, files(name)",
            pageToken=page_token,
        ).execute()
        names.update(f["name"] for f in resp.get("files", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return names


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--key-file", required=True, help="service account JSON key")
    parser.add_argument("--folder-id", required=True, help="target Google Drive folder ID")
    parser.add_argument("--source", default="posts")
    args = parser.parse_args()

    service = get_service(args.key_file)
    existing = list_existing_filenames(service, args.folder_id)

    uploaded = 0
    for path in sorted(Path(args.source).glob("*.md")):
        if path.name in existing:
            continue
        media = MediaFileUpload(str(path), mimetype="text/markdown")
        metadata = {"name": path.name, "parents": [args.folder_id]}
        service.files().create(body=metadata, media_body=media).execute()
        uploaded += 1
        print(f"[uploaded] {path.name}")

    print(f"Done. {uploaded} new file(s) uploaded to Drive folder {args.folder_id}.")


if __name__ == "__main__":
    main()
