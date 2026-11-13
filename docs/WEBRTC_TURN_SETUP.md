# ChitChat WebRTC relay configuration

The application requests short-lived ICE configuration from the authenticated
`get-call-ice-servers` Edge Function. The function verifies that the signed-in
user is a caller or callee in an active call session.

## Required Supabase Edge Function secrets

Configure these in the Supabase project secrets store. Do not put the shared
secret in Expo public variables, app.json, source control, or the APK.

- `TURN_URLS`: comma-separated relay URLs, for example
  `turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp`.
- `TURN_SHARED_SECRET`: the coturn REST API static-auth-secret.
- `STUN_URLS` (optional): comma-separated STUN URLs. If omitted, the function
  returns Google's public STUN server as a fallback.

The function creates a TURN REST username in the format
`expiry-unix-seconds:user-uuid` and an HMAC-SHA1 credential. Credentials expire
no later than 15 minutes after issue and never later than the call session.

## coturn requirements

Configure coturn with the same `static-auth-secret`, enable
`use-auth-secret`, and require TLS for internet-facing TURN/TCP where possible.
Open the relevant UDP and TLS/TCP relay ports in the server firewall. Use your
own relay hostname and valid TLS certificate. Do not expose an unauthenticated
TURN relay.

## Release status

The signed-in TURN credential endpoint and the client parser are implemented.
The actual WebRTC peer connection, native microphone/camera runtime, app call
controls, relay service provisioning, EAS environment/secrets setup and
Android/iOS two-device tests remain release blockers. Until those pass, the
Calls screen must continue to state that media calling is unavailable.
