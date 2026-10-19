#!/bin/bash
set -euo pipefail

action=${1:-apply}
rule=(-p tcp -m multiport --dports 80,443 -m comment --comment gtnh-planner-web -j ACCEPT)
for command in iptables ip6tables; do
    case "$action" in
        apply)
            "$command" -w -C INPUT "${rule[@]}" 2>/dev/null || "$command" -w -A INPUT "${rule[@]}"
            ;;
        remove)
            while "$command" -w -C INPUT "${rule[@]}" 2>/dev/null; do
                "$command" -w -D INPUT "${rule[@]}"
            done
            ;;
        *)
            printf 'Usage: %s [apply|remove]\n' "$0" >&2
            exit 2
            ;;
    esac
done
