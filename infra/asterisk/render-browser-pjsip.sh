#!/bin/sh
set -eu

browser_uri="${SIP_URI:-}"
browser_password="${SIP_PASSWORD:-}"

if [ -z "$browser_uri" ] || [ -z "$browser_password" ]; then
  echo "SIP_URI and SIP_PASSWORD must be set for the browser SIP endpoint." >&2
  exit 1
fi

browser_username="${browser_uri#sip:}"
browser_username="${browser_username#sips:}"
browser_username="${browser_username%%@*}"

if [ -z "$browser_username" ] || [ "$browser_username" = "$browser_uri" ]; then
  echo "SIP_URI must look like sip:1001@asterisk-host." >&2
  exit 1
fi

cat >/etc/asterisk/pjsip.browser.conf <<EOF
; Generated from SIP_URI and SIP_PASSWORD at container start.
[browser${browser_username}-auth]
type=auth
auth_type=userpass
username=${browser_username}
password=${browser_password}

[browser${browser_username}-aor]
type=aor
max_contacts=1
remove_existing=yes

[browser${browser_username}]
type=endpoint
transport=transport-ws
context=from-web
disallow=all
allow=ulaw,alaw
auth=browser${browser_username}-auth
aors=browser${browser_username}-aor
webrtc=yes
use_avpf=yes
media_encryption=dtls
dtls_auto_generate_cert=yes
dtls_verify=fingerprint
dtls_setup=actpass
ice_support=yes
rtcp_mux=yes
direct_media=no
rewrite_contact=yes
force_rport=yes
EOF

exec "$@"
