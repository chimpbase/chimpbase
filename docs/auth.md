# @chimpbase/auth

API key authentication and user management plugin for Chimpbase.

## Installation

```bash
bun add @chimpbase/auth
```

## Quick Start

```ts
import { chimpbaseAuth } from "@chimpbase/auth";

// Add to your app registrations
const auth = chimpbaseAuth({
  bootstrapKeySecret: "CHIMPBASE_BOOTSTRAP_API_KEY",
});
```

Set a bootstrap API key in your `.env`:

```
CHIMPBASE_BOOTSTRAP_API_KEY=my-secret-bootstrap-key
```

Use the bootstrap key to create your first user and API key:

```bash
# Create a user
curl -X POST http://localhost:3000/_auth/users \
  -H "X-API-Key: my-secret-bootstrap-key" \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@example.com", "name": "Admin", "role": "admin"}'

# Create an API key for the user (returns the key once — save it)
curl -X POST http://localhost:3000/_auth/users/<user-id>/keys \
  -H "X-API-Key: my-secret-bootstrap-key" \
  -H "Content-Type: application/json" \
  -d '{"label": "production"}'
```

All subsequent requests must include a valid API key:

```bash
curl http://localhost:3000/my-route \
  -H "X-API-Key: <your-api-key>"

# or with Authorization header
curl http://localhost:3000/my-route \
  -H "Authorization: Bearer <your-api-key>"
```

## Configuration

```ts
chimpbaseAuth({
  // Which paths require authentication. Default: "all"
  protectedPaths: "all",
  // or protect specific prefixes:
  // protectedPaths: ["/api", "/_webhooks"],

  // Paths excluded from authentication. Default: ["/health"]
  excludePaths: ["/health"],

  // Secret name for bootstrap API key (read via ctx.secret())
  bootstrapKeySecret: "CHIMPBASE_BOOTSTRAP_API_KEY",

  // Base path for management API. Set to null to disable. Default: "/_auth"
  managementBasePath: "/_auth",
})
```

## How It Works

The plugin registers a **guard route** that runs before all other routes. On each request it:

1. Checks if the path is excluded (e.g., `/health`) — if so, passes through
2. Checks if the path is protected — if not, passes through
3. Extracts the API key from `X-API-Key` header or `Authorization: Bearer` header
4. Returns `401` if no key is present
5. Checks the bootstrap key (if configured)
6. Hashes the key with SHA-256 and looks it up in the `__chimpbase.auth.api_keys` collection
7. Returns `401` if the key is not found, revoked, or expired
8. Passes through to the actual route handler

API keys are stored as SHA-256 hashes. The plaintext key is only returned once at creation time.

## Management API

All management endpoints are served under the configured `managementBasePath` (default: `/_auth`) and are themselves protected by the auth guard.

### Users

#### Create User

```
POST /_auth/users
```

```json
{
  "email": "user@example.com",
  "name": "Jane Doe",
  "role": "admin"
}
```

`role` is optional and defaults to `"user"`.

Returns the created user with `201`.

#### List Users

```
GET /_auth/users
```

Returns an array of all users.

#### Delete User

```
DELETE /_auth/users/:id
```

Deletes the user and revokes all their API keys. Returns `204` on success, `404` if not found.

### API Keys

#### Create API Key

```
POST /_auth/users/:userId/keys
```

```json
{
  "label": "production",
  "expiresAt": "2025-12-31T23:59:59Z"
}
```

Both fields are optional. Returns the created key **including the plaintext key** with `201`. This is the only time the full key is returned — store it securely.

Response:

```json
{
  "id": "...",
  "userId": "...",
  "key": "a1b2c3d4e5f6...",
  "keyPrefix": "a1b2c3d4",
  "label": "production",
  "createdAt": "...",
  "expiresAt": "2025-12-31T23:59:59Z"
}
```

#### List API Keys

```
GET /_auth/users/:userId/keys
```

Returns an array of keys for the user. Only the `keyPrefix` (first 8 characters) is shown, never the full key.

#### Revoke API Key

```
DELETE /_auth/keys/:id
```

Revokes the API key. Returns `204` on success, `404` if not found or already revoked.

## Actions

All actions are available for programmatic use within your Chimpbase app:

| Action | Args | Description |
|--------|------|-------------|
| `__chimpbase.auth.createUser` | `{ email, name, role? }` | Create a user |
| `__chimpbase.auth.listUsers` | — | List all users |
| `__chimpbase.auth.getUser` | `id` | Get a single user |
| `__chimpbase.auth.deleteUser` | `id` | Delete user and revoke keys |
| `__chimpbase.auth.createApiKey` | `{ userId, label?, expiresAt? }` | Generate a new API key |
| `__chimpbase.auth.listApiKeys` | `userId` | List keys for a user |
| `__chimpbase.auth.revokeApiKey` | `keyId` | Revoke an API key |
| `__chimpbase.auth.validateApiKey` | `rawKey` | Validate a key, returns `{ valid, userId, bootstrap }` |

Example from an action handler:

```ts
action("myAction", async (ctx) => {
  const user = await ctx.action("__chimpbase.auth.createUser", {
    email: "new@example.com",
    name: "New User",
  });

  const key = await ctx.action("__chimpbase.auth.createApiKey", {
    userId: user.id,
    label: "default",
  });

  // key.key contains the plaintext API key
});
```

## Data Storage

The plugin uses two Chimpbase collections (stored in the framework's `_chimpbase_collections` table):

- `__chimpbase.auth.users` — user records
- `__chimpbase.auth.api_keys` — API key records (hashed)

No additional migrations are required.
