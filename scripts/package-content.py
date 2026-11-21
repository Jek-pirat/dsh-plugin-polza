"""Print a stable content digest of an npm pack archive."""
import hashlib
import json
import sys
import tarfile


def digest(path):
    records = []
    with tarfile.open(path) as archive:
        for member in archive:
            if member.isdir():
                continue
            if not member.isfile():
                raise ValueError(f"Unexpected archive entry: {member.name}")
            data = archive.extractfile(member).read()
            if member.name == "package/package.json":
                manifest = json.loads(data)
                del manifest["version"]
                data = json.dumps(manifest, sort_keys=True).encode()
            records.append((member.name, member.mode & 0o111, hashlib.sha256(data).hexdigest()))
    return hashlib.sha256(json.dumps(sorted(records)).encode()).hexdigest()


if __name__ == "__main__":
    print(digest(sys.argv[1]))
