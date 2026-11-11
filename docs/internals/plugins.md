# Plugin boundary

Custom features belong to plugins. T3 Code supplies generic extension points and
host services; feature parsing, presentation, and integration policy stay in the
plugin. Plugins run as trusted application code, not in a security sandbox.

## Composition and compatibility

Each host has a build-time `plugins/installed*` composition root. The web registry
collects Markdown transforms and renderers, thread header and details sections,
sidebar utilities and thread annotations, provider settings extensions, and connection
setup panels. The native registry
has separate React Native header and Markdown renderers. Shared environment-scoped queries and guarded commands live in
`packages/client-runtime/plugins`; web components never become native dependencies.

The server composition roots register typed RPC handlers, required scopes,
observability metadata, lifecycle services, MCP toolkits, provider drivers, and
migrations. Protocol and provider code are workspace packages. They retain existing
RPC names and schema shapes, so moving code does not require clients to upgrade
in lockstep. The host continues to enforce authentication and permissions.
Plugin handler and migration collisions fail during registration; web plugin,
section, and provider-settings collisions also fail during registration.

Application plugins use `src/plugins/api` and `src/plugins/host` for access to their
host. Shared packages are public dependencies. Keep those facades small: exposing
a host service does not justify moving feature policy back into the host. Provider
adapters reuse the existing provider registry instead of introducing a second
provider protocol.

## Durable identity

Workflow identity is daemon plus run ID, scoped to an environment. HIDs alone
are not globally unique. Detection does not establish ownership or create tracking
links. Shared lookup preserves multiple daemon matches and never silently chooses
one for a mutation. The web details section keeps its existing `workflows` setting
key so users retain their preferences.

Tixim migrations live in the plugin and record their history in their own
`tixim_sql_migrations` table, numbered from 1, so core keeps its id sequence. They
run after core migrations because their tables reference core tables. Builds
before this table recorded them as core ids 73–78; startup moves those rows into
the plugin table by name before the core migrator reads its history, and the
service preflight and reported database version read the history the same way.
Migration names must therefore be unique across core and every plugin. Never
remove these migrations when disabling runtime contributions: historical data
must remain readable and migrations must not replay. The plugin migration tests
protect the legacy adoption, relationship conversion, and persisted waits.

## Installation and verification

This is build-time composition, not a dynamic loader or marketplace. The switch in
`packages/plugin-tixim-contracts/src/configuration.ts` controls all hosts together.
When disabled, UI contributions, provider registration, desktop IPC, MCP tools,
and wait-worker startup are absent. Existing RPC methods return typed disabled
errors behind the same authorization checks; historical schemas and migrations
remain available. Inert server service objects remain constructed so the host's
statically typed layer graph is stable, but no plugin worker starts.

`T3CODE_TIXIM=0` in the server's environment is the startup equivalent for server
contributions: agent instructions, MCP tools, the provider driver, RPC handlers,
and the worker. It is read once at server start because agent text and MCP tools
are fixed for the process. Clients are unaffected and see the typed disabled errors.

Desktop project discovery, its preload bridge, and model-facing workflow text are
plugin contributions. Native uses tap-to-open workflow details instead of mouse
hover. The native app's provider settings screen manages accounts rather than
schema-based provider configuration; custom provider configuration stays in the
web/desktop settings surface.

The SQLite upgrade/reopen test, disabled-startup test, RPC authorization tests,
shared daemon-routing test, compiler checks, and integrated Markdown browser test
cover the boundaries most likely to regress. Native device access must be enabled
to establish real-device acceptance. Unit and browser fixtures do not establish
live daemon or deployment acceptance.
