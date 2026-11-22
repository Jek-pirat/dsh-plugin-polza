#!/usr/bin/env bash
set -euo pipefail

package=$(node -p 'require("./package.json").name')
registry=$(curl --fail --silent --show-error --retry 3 "https://registry.npmjs.org/$package/latest")
latest=$(jq -er .version <<< "$registry")
published_sha=$(jq -er .gitHead <<< "$registry")

ensure_release() {
  local tag="v$1" sha="$2"
  if git rev-parse --verify --quiet "refs/tags/$tag" >/dev/null; then
    test "$(git rev-list -1 "$tag")" = "$sha"
  fi
  if ! gh release view "$tag" >/dev/null 2>&1; then
    gh release create "$tag" --target "$sha" --generate-notes
  fi
}

# Finish any previous publication interrupted after npm accepted it.
ensure_release "$latest" "$published_sha"
version=$(node -p 'require("./package.json").version')
if [[ "$GITHUB_REF_TYPE" == tag ]]; then
  test "$GITHUB_REF_NAME" = "v$version"
  if [[ "$version" == "$latest" ]]; then
    test "$(git rev-parse HEAD)" = "$published_sha"
    exit 0
  fi
elif [[ "$(git ls-remote --exit-code origin refs/heads/main | cut -f1)" != "$(git rev-parse HEAD)" ]]; then
  echo "A newer main revision will check the package."
  exit 0
else
  scratch=$(mktemp -d)
  local_pack=$(npm pack --silent --ignore-scripts --pack-destination "$scratch")
  mkdir "$scratch/registry"
  registry_pack=$(npm pack --silent "$package@$latest" --pack-destination "$scratch/registry")
  candidate=$(python3 scripts/package-content.py "$scratch/$local_pack")
  published=$(python3 scripts/package-content.py "$scratch/registry/$registry_pack")
  if [[ "$candidate" == "$published" ]]; then
    echo "Package matches npm $latest."
    exit 0
  fi
  if [[ "$version" == "$latest" ]]; then
    npm version patch --no-git-tag-version --ignore-scripts
    version=$(node -p 'require("./package.json").version')
    git config user.name 'github-actions[bot]'
    git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
    git add package.json package-lock.json
    git commit -m "Release v$version"
    git push origin HEAD:main
  fi
fi

# An old tag or a stale manifest must never move the npm latest tag backwards.
node -e '
  const [latest, next] = process.argv.slice(1)
  const stable = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/
  if (![latest, next].every(v => stable.test(v))) process.exit(1)
  const a = latest.split(".").map(Number), b = next.split(".").map(Number)
  const first = a.findIndex((n, i) => n !== b[i])
  if (first < 0 || b[first] < a[first]) process.exit(1)
' "$latest" "$version"
if [[ "$GITHUB_REF_TYPE" != tag ]] && gh release view "v$version" >/dev/null 2>&1; then
  echo "::error::GitHub Release v$version exists but npm latest is $latest. Check npm Staged Packages before retrying."
  exit 1
fi
npm publish --ignore-scripts --provenance --access public
# npm may take several minutes to expose an accepted version (0.3.4 took ~2.5 min).
for attempt in {1..60}; do
  if curl -fsS "https://registry.npmjs.org/$package/latest" | jq -e --arg version "$version" '.version == $version' >/dev/null; then
    ensure_release "$version" "$(git rev-parse HEAD)"
    exit 0
  fi
  sleep 10
done
echo "::error::npm accepted $version but it is not visible as latest. Check npm Staged Packages."
exit 1
