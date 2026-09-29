#!/usr/bin/env bash
# Publish every public workspace package to npmjs.com.
#
# Runs inside the dev stack's workspace container by default, like the rest of
# `scripts/`: the install lives there, and a host pnpm would want to rebuild it. That
# means credentials come from `NPM_TOKEN` in the environment rather than from a
# `~/.npmrc` the container cannot see. Pass `--host` to run against a host install
# instead, where your own `npm login` applies.
#
# Trusted publishing (OIDC) cannot be used from here: it authenticates a CI runner, not a
# person, and npm only accepts it from GitHub Actions, GitLab CI or CircleCI. The release
# workflow in `.github/workflows/release.yml` is the trusted-publishing path, and it uses
# `--pack-only` below to build the tarballs it uploads. A token is still what publishes a
# package's *first* version, because a trusted publisher cannot be configured on npmjs.com
# until the package exists.
#
# It is a dry run unless you pass `--yes`. An npm publish is effectively irreversible -
# a version number can never be reused, even after unpublishing - so the safe thing has
# to be the thing that happens when you type the command wrong.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
cd "$ROOT"

# `NODE_AUTH_TOKEN` is what CI conventions tend to call it; one name from here on.
NPM_TOKEN="${NPM_TOKEN:-${NODE_AUTH_TOKEN:-}}"
export NPM_TOKEN

publish=false
bump=""
dist_tag="latest"
otp=""
run_checks=true
git_checks=true
on_host=false
pack_dir=""

usage() {
  cat <<'USAGE'
Usage: scripts/publish.sh [options]

  (no options)      dry run: check, build, and print exactly what would be published
  --yes             publish for real
  --version <bump>  set every publishable package to this version first;
                    `patch`, `minor`, `major`, or a literal version like 0.2.0
  --tag <name>      npm dist-tag to publish under (default: latest)
  --otp <code>      one-time password, for an account with 2FA on publishes
  --skip-checks     skip typecheck, lint and tests (they are the point; be sure)
  --no-git-checks   allow publishing from a dirty tree or a branch other than main
  --host            run pnpm on the host rather than in the dev container
  --pack-only <dir> build the tarballs into <dir> and stop; what CI publishes
  -h, --help        this message

Authentication: in container mode, export NPM_TOKEN (an npm token). On the host, `npm
login` once and it is used from your ~/.npmrc. Trusted publishing is CI-only - see
`.github/workflows/release.yml` and https://dev.manablox.io/deployment/releases/.

After a real publish it asks whether to commit the version bump, tag it v<version> and
push both; without a terminal it only prints those commands.

Every workspace package that is not marked private (the libraries under `packages/` and the
prebuilt admin under `apps/admin`) is published together, at one
shared version. pnpm rewrites the `workspace:` and `catalog:` specifiers to real ranges
in the published manifests, and skips any version already on the registry.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --yes) publish=true ;;
    --version) bump="${2:?--version needs a bump or a version}"; shift ;;
    --tag) dist_tag="${2:?--tag needs a name}"; shift ;;
    --otp) otp="${2:?--otp needs a code}"; shift ;;
    --skip-checks) run_checks=false ;;
    --no-git-checks) git_checks=false ;;
    --host) on_host=true ;;
    --pack-only) pack_dir="${2:?--pack-only needs a directory}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage_error "unknown option '$1'" ;;
  esac
  shift
done

step() { printf '\npublish: %s\n' "$1"; }

# pnpm's own settings travel as `npm_config_*` environment variables, and the dev image
# sets two of them (`store-dir`, `confirm-modules-purge`). npm reads that namespace too,
# knows neither, and warns about both on every single call - twice per invocation, which
# buries this script's output. So npm is run without them; pnpm still sees them.
NPM_ENV="env -u npm_config_store_dir -u npm_config_confirm_modules_purge"

# Every pnpm and npm invocation goes through this, so container and host mode differ in
# exactly one place rather than at each call site.
if [ "$on_host" = true ]; then
  command -v pnpm >/dev/null || {
    echo "publish: --host needs pnpm on the host; drop the flag to use the dev container" >&2
    exit 2
  }
  WORKDIR="$ROOT"
  run() { ( cd "$ROOT" && "$@" ); }
  NPMRC="$ROOT/.publish-npmrc"
  trap 'rm -f "$NPMRC"' EXIT
else
  DEV="$ROOT/scripts/dev.sh"
  "$DEV" ps --status running --services 2>/dev/null | grep -qx api || {
    echo "publish: the dev stack is not running - start it with 'scripts/dev.sh up', or pass --host" >&2
    exit 2
  }
  # The repository is bind-mounted at /app in the workspace container, so a file written
  # to $ROOT here is readable at /app there.
  WORKDIR=/app
  NPMRC="$ROOT/.publish-npmrc"
  trap 'rm -f "$NPMRC"' EXIT
  run() {
    local command
    command="$(printf '%q ' "$@")"
    # `CI=true` so a workspace command never stops to ask about the modules directory,
    # and the token is passed per-exec rather than baked into the image.
    "$DEV" exec -T \
      -e CI=true \
      -e NPM_TOKEN \
      -e NPM_CONFIG_USERCONFIG="$WORKDIR/.publish-npmrc" \
      api sh -lc "$command"
  }
fi

# --- what would go out ----------------------------------------------------

# The manifests are the authority on what is publishable, so nothing here is a hardcoded
# list that a new package could be forgotten from.
mapfile -t publishable < <(run node scripts/lib/publishable.mjs)

[ "${#publishable[@]}" -gt 0 ] || { echo "publish: no publishable packages found" >&2; exit 1; }

# --- preflight ------------------------------------------------------------

if [ "$git_checks" = true ]; then
  branch="$(git rev-parse --abbrev-ref HEAD)"
  [ "$branch" = "main" ] || {
    echo "publish: on '$branch', not main - pass --no-git-checks if that is deliberate" >&2
    exit 2
  }
  git diff --quiet && git diff --cached --quiet || {
    echo "publish: the working tree has uncommitted changes; commit them or pass --no-git-checks" >&2
    exit 2
  }
fi

# npm reads a token from an `.npmrc`, never from `NPM_TOKEN` on its own - the variable is
# only a convention that works because something wrote a file referring to it. This is
# that file. It holds the *name*, expanded by npm at read time, so the token itself never
# lands on disk; `trap` removes it either way.
if [ -n "$NPM_TOKEN" ]; then
  printf '//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n' > "$NPMRC"
  chmod 600 "$NPMRC"
  if [ "$on_host" = true ]; then
    export NPM_CONFIG_USERCONFIG="$NPMRC"
  fi
fi

if [ "$publish" = true ]; then
  step "checking npm authentication"
  if [ "$on_host" = false ] && [ -z "$NPM_TOKEN" ]; then
    echo "publish: NPM_TOKEN is not set - export an npm token, or use --host" >&2
    exit 2
  fi
  run $NPM_ENV npm whoami >/dev/null 2>&1 || {
    echo "publish: npm rejected the credentials - the token may be expired, or lack" >&2
    echo "         write access to @manablox/*" >&2
    exit 2
  }
  echo "publish: publishing as $(run $NPM_ENV npm whoami)"
fi

# --- version --------------------------------------------------------------

if [ -n "$bump" ]; then
  step "setting every publishable package to '$bump'"
  for entry in "${publishable[@]}"; do
    read -r dir _name _version _kind <<<"$entry"
    # `--no-git-tag-version`: one tag for the release belongs to the repository, not one
    # per package. The end of a real publish offers to make it.
    run sh -c "cd '$dir' && $NPM_ENV npm version '$bump' --no-git-tag-version --allow-same-version >/dev/null"
  done
  mapfile -t publishable < <(run node scripts/lib/publishable.mjs)
  # The bump itself dirties the tree, so pnpm's own check would refuse from here on.
  git_checks=false
fi

# --- checks and build -----------------------------------------------------

if [ "$run_checks" = true ]; then
  step "typecheck"; run pnpm typecheck
  step "lint"; run pnpm lint
  step "test"; run pnpm test
fi

# `pnpm publish` runs each package's `prepack`, and none of these declare one: every
# package's `dist` - what its `publishConfig` points the tarball at - comes from the
# workspace build.
step "build"
# The dev container exports NODE_ENV=development, which makes Vite emit development builds.
run env NODE_ENV=production pnpm build

# --- report ---------------------------------------------------------------

step "packages"
source_only=()
for entry in "${publishable[@]}"; do
  read -r _dir name version kind <<<"$entry"
  printf '  %-28s %s\n' "$name" "$version"
  if [ "$kind" = "src" ]; then source_only+=("$name"); fi
done

if [ "${#source_only[@]}" -gt 0 ]; then
  cat <<NOTE

publish: ${#source_only[@]} of these would publish TypeScript source rather than the
         compiled build - their published entry points into src/. Every library is
         meant to carry a \`publishConfig\` that swaps exports to dist/ when packed;
         check that package's manifest before publishing.
NOTE
fi

# --- pack -----------------------------------------------------------------

if [ -n "$pack_dir" ]; then
  # It is emptied before use, so it has to be a path inside the repository and nothing
  # clever: no absolute paths, no `..`.
  case "$pack_dir" in
    /*|*..*) echo "publish: --pack-only needs a relative path inside the repository" >&2; exit 2 ;;
  esac

  step "packing into $pack_dir"
  # `pnpm pack`, not `npm pack`: only pnpm turns the `workspace:` and `catalog:`
  # specifiers into the real ranges a consumer can install.
  run sh -c "rm -rf '$WORKDIR/$pack_dir' && mkdir -p '$WORKDIR/$pack_dir'"
  for entry in "${publishable[@]}"; do
    read -r dir _name _version _kind <<<"$entry"
    run sh -c "cd '$WORKDIR/$dir' && pnpm pack --pack-destination '$WORKDIR/$pack_dir' >/dev/null"
  done
  run sh -c "ls -1 '$WORKDIR/$pack_dir'"
  exit 0
fi

# --- publish --------------------------------------------------------------

args=(--recursive --access public --tag "$dist_tag")
if [ -n "$otp" ]; then args+=(--otp "$otp"); fi
if [ "$git_checks" = false ]; then args+=(--no-git-checks); fi

if [ "$publish" = false ]; then
  step "dry run - nothing is sent to the registry"
  run pnpm publish "${args[@]}" --dry-run
  echo
  echo "publish: re-run with --yes to publish these for real."
  exit 0
fi

step "publishing to npmjs.com under the '$dist_tag' tag"
run pnpm publish "${args[@]}"

version="$(run node -p 'JSON.parse(require("node:fs").readFileSync("packages/core/package.json","utf8")).version')"
tag="v$version"

# The commands that record the release in git, printed when they are not run here.
release_commands() {
  cat <<COMMANDS

  git commit -m "chore(release): $tag" -- '*package.json'
  git tag "$tag"
  git push && git push origin "$tag"
COMMANDS
}

echo
echo "publish: done."

# Git runs on the host, where the repository and its credentials are. Without a terminal
# nobody can answer, so the commands are only printed, as they always were.
if [ ! -t 0 ] || ! confirm "commit the release, tag it $tag and push both?"; then
  echo "publish: nothing committed. To record the release in git:"
  release_commands
  exit 0
fi

# Only the manifests the bump touched: with --no-git-checks the tree may hold other work,
# which does not belong in the release commit. Without --version nothing was bumped.
manifests=()
for entry in "${publishable[@]}"; do
  read -r dir _name _version _kind <<<"$entry"
  manifests+=("$dir/package.json")
done
if git diff --quiet -- "${manifests[@]}"; then
  echo "publish: no version change to commit; tagging HEAD"
else
  step "committing the release"
  git commit -m "chore(release): $tag" -- "${manifests[@]}"
fi

if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "publish: the tag $tag already exists; leaving it as it is" >&2
else
  step "tagging $tag"
  git tag "$tag"
fi

step "pushing the branch and $tag"
if ! { git push && git push origin "$tag"; }; then
  echo "publish: the push failed; the commit and the tag are local. Push them with:" >&2
  echo "  git push && git push origin \"$tag\"" >&2
  exit 1
fi
echo "publish: $tag is committed, tagged and pushed."
