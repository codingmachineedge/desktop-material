#!/bin/sh

CONTENTS="$(dirname "$(dirname "$(dirname "$(dirname "$(realpath "$0")")")")")"
ELECTRON="$CONTENTS/GitHubDesktop.exe"

if grep -q Microsoft /proc/version; then
	if [ -x /bin/wslpath ]; then
		# On recent WSL builds, WSLENV makes the Node-mode flag visible to Windows.
		export WSLENV=ELECTRON_RUN_AS_NODE/w:$WSLENV
		CLI=$(wslpath -m "$CONTENTS/resources/app/cli.js")
	else
		# Older WSL builds cannot transfer the environment required by Electron.
		"$ELECTRON" "$@"
		exit $?
	fi
elif [ "$(expr substr $(uname -s) 1 9)" = "CYGWIN_NT" ]; then
	CLI=$(cygpath -m "$CONTENTS/resources/app/cli.js")
else
	CLI="$CONTENTS/resources/app/cli.js"
fi

ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$CLI" "$@"

exit $?
